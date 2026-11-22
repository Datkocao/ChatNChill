using System.Diagnostics;
using System.Text;
using System.Text.Json;
using ChatAndChill.Data;
using ChatAndChill.Models;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Security.Cryptography;

namespace ChatAndChill.Services;

// Lỗi có thông báo an toàn để hiện cho người dùng
public class ImportException : Exception
{
    public ImportException(string message) : base(message) { }
}

// Chạy nền: lấy từng yêu cầu trong hàng đợi, gọi yt-dlp, đưa mp3 lên R2 rồi tạo bài trong thư viện
public class TrackImportWorker : BackgroundService
{
    private const int MaxDurationSeconds = 15 * 60;
    private static readonly TimeSpan MetadataTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan DownloadTimeout = TimeSpan.FromMinutes(5);

    private readonly TrackImportQueue _queue;
    private readonly IServiceScopeFactory _scopes;
    private readonly ToolsOptions _tools;
    private readonly ILogger<TrackImportWorker> _log;

    public TrackImportWorker(
        TrackImportQueue queue,
        IServiceScopeFactory scopes,
        IOptions<ToolsOptions> tools,
        ILogger<TrackImportWorker> log)
    {
        _queue = queue;
        _scopes = scopes;
        _tools = tools.Value;
        _log = log;
    }

    private sealed record Metadata(string Id, string Title, string? Artist, int Seconds);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await MarkInterruptedAsync();

        try
        {
            await foreach (var id in _queue.ReadAllAsync(stoppingToken))
            {
                try
                {
                    await ProcessAsync(id, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
                {
                    break;
                }
                catch (Exception ex)
                {
                    _log.LogError(ex, "Lỗi không mong đợi khi xử lý nhập nhạc {Id}", id);
                }
            }
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
            // đang tắt server
        }
    }

    // Hàng đợi nằm trong bộ nhớ nên khi server khởi động lại, các lần nhập dở dang phải báo lỗi
    private async Task MarkInterruptedAsync()
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var stuck = await db.TrackImports.Where(i => i.Status != ImportStatus.Failed).ToListAsync();
            foreach (var i in stuck)
            {
                i.Status = ImportStatus.Failed;
                i.Error = "Máy chủ đã khởi động lại giữa chừng, hãy nhập lại.";
            }
            if (stuck.Count > 0) await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            // thường do chưa chạy migration; không để làm sập server
            _log.LogWarning(ex, "Không dọn được các lần nhập nhạc dở dang (đã chạy migration chưa?)");
        }
    }

    private async Task ProcessAsync(int importId, CancellationToken ct)
    {
        using var scope = _scopes.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var r2 = scope.ServiceProvider.GetRequiredService<R2StorageService>();

        var imp = await db.TrackImports.FirstOrDefaultAsync(i => i.Id == importId, ct);
        if (imp is null || imp.Status != ImportStatus.Queued) return;

        imp.Status = ImportStatus.Processing;
        await db.SaveChangesAsync(ct);

        var tempDir = Path.Combine(Path.GetTempPath(), "chatandchill-import", Guid.NewGuid().ToString("N"));
        string? uploadedKey = null;

        try
        {
            var ytdlp = ResolveTool("yt-dlp.exe");
            ResolveTool("ffmpeg.exe");   // chỉ để báo lỗi sớm nếu thiếu
            Directory.CreateDirectory(tempDir);

            // 1. Đọc thông tin bài, kiểm tra thời lượng trước khi tải
            var meta = await ReadMetadataAsync(ytdlp, imp.Url, tempDir, ct);
            imp.Title = Clip(meta.Title, 150);
            await db.SaveChangesAsync(ct);

            var ownerId = imp.OwnerId;
            var sourceId = $"youtube:{meta.Id}";

            // 1b. Bài này đã có trong kho: bỏ qua tải, chỉ thêm vào danh sách của người nhập
            var existing = await db.Tracks.FirstOrDefaultAsync(t => t.SourceId == sourceId, ct);
            if (existing is not null)
            {
                await FinishWithExistingAsync(db, importId, ownerId, existing.Id, ct);
                return;
            }

            var total = await db.Tracks.SumAsync(t => (long?)t.SizeBytes, ct) ?? 0;
            if (total >= MusicLimits.LibraryQuotaBytes)
                throw new ImportException("Kho nhạc chung đã đầy.");

            // 2. Tải và đổi sang mp3
            var mp3 = await DownloadMp3Async(ytdlp, imp.Url, tempDir, ct);
            var length = new FileInfo(mp3).Length;
            if (length == 0 || length > MusicLimits.MaxFileBytes)
                throw new ImportException("File tải về quá lớn hoặc bị lỗi.");
            if (!LooksLikeMp3(mp3))
                throw new ImportException("File tải về không phải âm thanh hợp lệ.");
            if (total + length > MusicLimits.LibraryQuotaBytes)
                throw new ImportException("Kho nhạc chung đã đầy.");

            string hash;
            await using (var hs = File.OpenRead(mp3))
            {
                hash = Convert.ToHexString(await SHA256.HashDataAsync(hs, ct)).ToLowerInvariant();
            }

            // 3. Đưa lên R2 (tên ngẫu nhiên, nằm chung trong music/)
            var key = $"music/{Guid.NewGuid():N}.mp3";
            await using (var fs = File.OpenRead(mp3))
            {
                await r2.UploadAsync(key, fs, "audio/mpeg", ct);
            }
            uploadedKey = key;

            // 4. Tạo bài, thêm vào danh sách người nhập và xoá dòng nhập trong cùng một giao dịch
            var track = new Track
            {
                UploaderId = ownerId,
                Title = Clip(meta.Title, 150),
                Artist = meta.Artist is null ? null : Clip(meta.Artist, 100),
                DurationSeconds = meta.Seconds,
                ObjectKey = key,
                ContentType = "audio/mpeg",
                SizeBytes = length,
                Origin = TrackOrigin.Youtube,
                SourceId = sourceId,
                ContentHash = hash
            };

            try
            {
                await using var tx = await db.Database.BeginTransactionAsync(ct);
                db.Tracks.Add(track);
                await db.SaveChangesAsync(ct);

                db.UserTracks.Add(new UserTrack { UserId = ownerId, TrackId = track.Id });
                db.TrackImports.Remove(imp);
                await db.SaveChangesAsync(ct);

                await tx.CommitAsync(ct);
                uploadedKey = null;   // đã lưu xong, không cần dọn
            }
            catch (DbUpdateException)
            {
                // hai bên nhập cùng một bài cùng lúc (trùng SourceId hoặc ContentHash): dùng bài đã có
                db.ChangeTracker.Clear();
                var dup = await db.Tracks.FirstOrDefaultAsync(
                    t => t.SourceId == sourceId || t.ContentHash == hash, ct);
                if (dup is null) throw;

                await FinishWithExistingAsync(db, importId, ownerId, dup.Id, ct);
                // uploadedKey vẫn còn giá trị nên khối finally sẽ xoá file vừa tải lên R2
            }
        }
        catch (ImportException ex)
        {
            await FailAsync(importId, ex.Message);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            await FailAsync(importId, "Máy chủ đang tắt nên bài này bị ngắt giữa chừng, hãy nhập lại.");
            throw;
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Nhập nhạc {Id} thất bại", importId);
            await FailAsync(importId, "Lỗi không xác định khi nhập nhạc (xem log máy chủ).");
        }
        finally
        {
            if (uploadedKey is not null)
                await r2.DeleteAsync(new[] { uploadedKey });   // không để file mồ côi trên R2
            try { Directory.Delete(tempDir, recursive: true); } catch { /* bỏ qua */ }
        }
    }

    // Bài đã có trong kho: chỉ thêm vào danh sách của người nhập và xoá dòng nhập
    private static async Task FinishWithExistingAsync(
        AppDbContext db, int importId, int ownerId, int trackId, CancellationToken ct)
    {
        if (!await db.UserTracks.AnyAsync(u => u.UserId == ownerId && u.TrackId == trackId, ct))
            db.UserTracks.Add(new UserTrack { UserId = ownerId, TrackId = trackId });

        var row = await db.TrackImports.FirstOrDefaultAsync(i => i.Id == importId, ct);
        if (row is not null) db.TrackImports.Remove(row);

        await db.SaveChangesAsync(ct);
    }

    // Dùng DbContext mới vì context cũ có thể đang ở trạng thái lỗi sau một lần SaveChanges hỏng
    private async Task FailAsync(int importId, string message)
    {
        try
        {
            using var scope = _scopes.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var row = await db.TrackImports.FirstOrDefaultAsync(i => i.Id == importId);
            if (row is null) return;
            row.Status = ImportStatus.Failed;
            row.Error = Clip(message, 300);
            await db.SaveChangesAsync();
        }
        catch (Exception ex)
        {
            _log.LogError(ex, "Không ghi được trạng thái lỗi của lần nhập {Id}", importId);
        }
    }

    // ---------- Gọi yt-dlp ----------

    private async Task<Metadata> ReadMetadataAsync(string ytdlp, string url, string workDir, CancellationToken ct)
    {
        var (code, output, error) = await RunAsync(ytdlp, new[]
        {
            "--ignore-config", "--no-playlist", "--no-warnings", "--skip-download",
            "--dump-json", "--socket-timeout", "30",
            "--", url
        }, workDir, MetadataTimeout, ct);

        if (code != 0) throw new ImportException(Explain(error));

        var line = output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault();
        if (line is null) throw new ImportException("Không đọc được thông tin bài này.");

        JsonDocument doc;
        try { doc = JsonDocument.Parse(line); }
        catch (JsonException) { throw new ImportException("Không đọc được thông tin bài này."); }

        using (doc)
        {
            var root = doc.RootElement;

            if (root.TryGetProperty("is_live", out var live) && live.ValueKind == JsonValueKind.True)
                throw new ImportException("Không nhập được video đang phát trực tiếp.");

            if (!root.TryGetProperty("duration", out var d) || d.ValueKind != JsonValueKind.Number)
                throw new ImportException("Không xác định được thời lượng bài này.");

            var seconds = (int)Math.Round(d.GetDouble());
            if (seconds <= 0) throw new ImportException("Không xác định được thời lượng bài này.");
            if (seconds > MaxDurationSeconds)
                throw new ImportException($"Bài dài quá {MaxDurationSeconds / 60} phút.");

            var id = Str(root, "id");
            if (id is null || id.Length is < 6 or > 20 || !id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
                throw new ImportException("Không xác định được mã video.");

            var title = Str(root, "title") ?? "Không tên";
            var artist = Str(root, "artist") ?? Str(root, "uploader") ?? Str(root, "channel");
            return new Metadata(id, title, artist, seconds);
        }
    }

    private async Task<string> DownloadMp3Async(string ytdlp, string url, string workDir, CancellationToken ct)
    {
        var (code, _, error) = await RunAsync(ytdlp, new[]
        {
            "--ignore-config", "--no-playlist", "--no-warnings", "--no-progress", "--no-mtime",
            "--socket-timeout", "30",
            "--max-filesize", MusicLimits.MaxFileBytes.ToString(),
            "--ffmpeg-location", _tools.Directory!,
            "-x", "--audio-format", "mp3", "--audio-quality", "128K",
            "-o", Path.Combine(workDir, "audio.%(ext)s"),
            "--", url
        }, workDir, DownloadTimeout, ct);

        var mp3 = Path.Combine(workDir, "audio.mp3");
        if (code != 0 || !File.Exists(mp3)) throw new ImportException(Explain(error));
        return mp3;
    }

    // Chạy một chương trình ngoài. Truyền tham số qua ArgumentList (không ghép chuỗi lệnh)
    internal static async Task<(int Code, string Output, string Error)> RunAsync(
        string exe, IReadOnlyList<string> args, string workDir, TimeSpan timeout, CancellationToken ct)
    {
        var psi = new ProcessStartInfo(exe)
        {
            WorkingDirectory = workDir,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8
        };
        foreach (var a in args) psi.ArgumentList.Add(a);

        using var proc = new Process { StartInfo = psi };
        proc.Start();

        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(timeout);

        var outTask = proc.StandardOutput.ReadToEndAsync(cts.Token);
        var errTask = proc.StandardError.ReadToEndAsync(cts.Token);

        try
        {
            await proc.WaitForExitAsync(cts.Token);
            return (proc.ExitCode, await outTask, await errTask);
        }
        catch (OperationCanceledException)
        {
            try { proc.Kill(entireProcessTree: true); } catch { /* bỏ qua */ }
            if (ct.IsCancellationRequested) throw;
            throw new ImportException("Quá thời gian chờ khi tải bài này.");
        }
    }

    private string ResolveTool(string fileName)
    {
        var dir = _tools.Directory;
        if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir))
            throw new ImportException("Máy chủ chưa cấu hình thư mục công cụ nhập nhạc (Tools:Directory).");
        var path = Path.Combine(dir, fileName);
        if (!File.Exists(path))
            throw new ImportException($"Không tìm thấy {fileName} trong thư mục công cụ.");
        return path;
    }

    // Đổi lỗi của yt-dlp thành thông báo dễ hiểu; nội dung đầy đủ chỉ ghi vào log, không gửi cho người dùng
    private string Explain(string stderr)
    {
        var tail = stderr.Length > 1500 ? stderr[^1500..] : stderr;
        _log.LogWarning("yt-dlp báo lỗi: {Error}", tail);

        var s = stderr.ToLowerInvariant();
        if (s.Contains("sign in to confirm"))
            return "YouTube đang yêu cầu xác minh nên không tải được. Thử lại sau hoặc cập nhật yt-dlp.";
        if (s.Contains("private video") || s.Contains("video unavailable") || s.Contains("not available"))
            return "Video không khả dụng hoặc đang ở chế độ riêng tư.";
        if (s.Contains("max-filesize") || s.Contains("larger than"))
            return "File quá lớn (tối đa 30 MB).";
        return "Không tải được bài này. Có thể cần cập nhật yt-dlp (xem log máy chủ).";
    }

    private static bool LooksLikeMp3(string path)
    {
        using var fs = File.OpenRead(path);
        var h = new byte[3];
        if (fs.Read(h, 0, 3) < 3) return false;
        return (h[0] == 'I' && h[1] == 'D' && h[2] == '3') || (h[0] == 0xFF && (h[1] & 0xE0) == 0xE0);
    }

    private static string? Str(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var s = v.GetString()?.Trim();
        return string.IsNullOrEmpty(s) ? null : s;
    }

    private static string Clip(string s, int max) => s.Length <= max ? s : s[..max];
}