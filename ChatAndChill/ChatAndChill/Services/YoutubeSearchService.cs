using System.Text.Json;
using ChatAndChill.Dtos;
using Microsoft.Extensions.Options;

namespace ChatAndChill.Services;

// Tìm bài trên YouTube bằng yt-dlp (chỉ lấy danh sách kết quả, không tải gì)
public class YoutubeSearchService
{
    private const int Wanted = 5;                  // số kết quả trả về
    private const int Fetched = 10;                // lấy dư để còn lọc bỏ video quá dài, video trực tiếp
    private const int MaxDurationSeconds = 15 * 60;
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(40);
    private static readonly SemaphoreSlim Gate = new(2);   // tối đa 2 lượt tìm cùng lúc

    private readonly ToolsOptions _tools;
    private readonly ILogger<YoutubeSearchService> _log;

    public YoutubeSearchService(IOptions<ToolsOptions> tools, ILogger<YoutubeSearchService> log)
    {
        _tools = tools.Value;
        _log = log;
    }

    public async Task<List<SearchResultDto>> SearchAsync(string query, CancellationToken ct)
    {
        var dir = _tools.Directory;
        if (string.IsNullOrWhiteSpace(dir) || !Directory.Exists(dir))
            throw new ImportException("Máy chủ chưa cấu hình thư mục công cụ nhập nhạc (Tools:Directory).");
        var ytdlp = Path.Combine(dir, "yt-dlp.exe");
        if (!File.Exists(ytdlp))
            throw new ImportException("Không tìm thấy yt-dlp.exe trong thư mục công cụ.");

        if (!await Gate.WaitAsync(TimeSpan.FromSeconds(5), ct))
            throw new ImportException("Đang có quá nhiều lượt tìm, thử lại sau ít giây.");

        try
        {
            // tiền tố tìm kiếm do server gắn, người dùng chỉ quyết định phần tên bài
            var (code, output, error) = await TrackImportWorker.RunAsync(ytdlp, new[]
            {
                "--ignore-config", "--no-warnings", "--flat-playlist", "--dump-json",
                "--socket-timeout", "30",
                "--", $"ytsearch{Fetched}:{query}"
            }, Path.GetTempPath(), Timeout, ct);

            if (code != 0)
            {
                var tail = error.Length > 1500 ? error[^1500..] : error;
                _log.LogWarning("yt-dlp tìm kiếm báo lỗi: {Error}", tail);
                throw new ImportException("Không tìm được bài. Thử lại sau hoặc cập nhật yt-dlp.");
            }

            var results = new List<SearchResultDto>();
            var seen = new HashSet<string>();

            foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            {
                JsonDocument doc;
                try { doc = JsonDocument.Parse(line); }
                catch (JsonException) { continue; }

                using (doc)
                {
                    var root = doc.RootElement;

                    var id = Str(root, "id");
                    if (id is null || id.Length is < 6 or > 20
                        || !id.All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_'))
                        continue;
                    if (!seen.Add(id)) continue;

                    var live = Str(root, "live_status");
                    if (live is "is_live" or "is_upcoming") continue;

                    if (!root.TryGetProperty("duration", out var d) || d.ValueKind != JsonValueKind.Number)
                        continue;
                    var seconds = (int)Math.Round(d.GetDouble());
                    if (seconds <= 0 || seconds > MaxDurationSeconds) continue;

                    results.Add(new SearchResultDto
                    {
                        VideoId = id,
                        Title = Clip(Str(root, "title") ?? "Không tên", 150),
                        Channel = Str(root, "channel") ?? Str(root, "uploader"),
                        DurationSeconds = seconds
                    });

                    if (results.Count == Wanted) break;
                }
            }

            return results;
        }
        finally
        {
            Gate.Release();
        }
    }

    private static string? Str(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var s = v.GetString()?.Trim();
        return string.IsNullOrEmpty(s) ? null : s;
    }

    private static string Clip(string s, int max) => s.Length <= max ? s : s[..max];
}