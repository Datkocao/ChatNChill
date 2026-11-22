using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Models;
using ChatAndChill.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Cryptography;

namespace ChatAndChill.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class MusicController : ControllerBase
{
    private const long MaxFileBytes = MusicLimits.MaxFileBytes;   // 30 MB mỗi bài
    private const int MaxActiveImports = 3;                       // số bài đang nhập cùng lúc của mỗi người
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromHours(6);

    private static readonly Dictionary<string, string> AllowedTypes =
        new(StringComparer.OrdinalIgnoreCase)
        {
            [".mp3"] = "audio/mpeg",
            [".m4a"] = "audio/mp4",
            [".ogg"] = "audio/ogg",
            [".wav"] = "audio/wav",
            [".flac"] = "audio/flac",
        };

    private readonly AppDbContext _db;
    private readonly R2StorageService _r2;
    private readonly TrackImportQueue _queue;
    private readonly YoutubeSearchService _search;

    public MusicController(AppDbContext db, R2StorageService r2, TrackImportQueue queue, YoutubeSearchService search)
    {
        _db = db;
        _r2 = r2;
        _queue = queue;
        _search = search;
    }

    // Danh sách phát của mình + dung lượng đã dùng của cả kho
    [HttpGet("tracks")]
    public async Task<ActionResult<TrackListDto>> List()
    {
        var me = User.GetUserId();

        var tracks = await (
            from u in _db.UserTracks
            where u.UserId == me
            join t in _db.Tracks on u.TrackId equals t.Id
            orderby u.AddedAt descending
            select new TrackDto
            {
                Id = t.Id,
                Title = t.Title,
                Artist = t.Artist,
                DurationSeconds = t.DurationSeconds,
                SizeBytes = t.SizeBytes,
                CreatedAt = t.CreatedAt,
                UploaderId = t.UploaderId,
                UploaderName = t.Owner.DisplayName,
                Origin = t.Origin,
                InLibrary = true
            }).ToListAsync();

        var libraryUsed = await _db.Tracks.SumAsync(t => (long?)t.SizeBytes) ?? 0;

        return Ok(new TrackListDto
        {
            Tracks = tracks,
            UsedBytes = libraryUsed,
            QuotaBytes = MusicLimits.LibraryQuotaBytes
        });
    }

    // Kho chung: mọi bài đã có, có tìm kiếm và phân trang
    [HttpGet("library")]
    public async Task<ActionResult<LibraryPageDto>> Library([FromQuery] string? q, [FromQuery] int page = 1)
    {
        var me = User.GetUserId();
        if (page < 1) page = 1;
        var size = MusicLimits.LibraryPageSize;

        var query = _db.Tracks.AsQueryable();
        var term = Clip((q ?? "").Trim(), 100);
        if (term.Length > 0)
        {
            var pattern = "%" + term.Replace("\\", "\\\\").Replace("%", "\\%").Replace("_", "\\_") + "%";
            query = query.Where(t => EF.Functions.ILike(t.Title, pattern)
                                  || (t.Artist != null && EF.Functions.ILike(t.Artist, pattern)));
        }

        var total = await query.CountAsync();
        var tracks = await query
            .OrderByDescending(t => t.Id)
            .Skip((page - 1) * size)
            .Take(size)
            .Select(t => new TrackDto
            {
                Id = t.Id,
                Title = t.Title,
                Artist = t.Artist,
                DurationSeconds = t.DurationSeconds,
                SizeBytes = t.SizeBytes,
                CreatedAt = t.CreatedAt,
                UploaderId = t.UploaderId,
                UploaderName = t.Owner.DisplayName,
                Origin = t.Origin,
                InLibrary = _db.UserTracks.Any(u => u.UserId == me && u.TrackId == t.Id)
            })
            .ToListAsync();

        return Ok(new LibraryPageDto { Tracks = tracks, Total = total, Page = page, PageSize = size });
    }

    // Upload một bài vào kho chung, tự thêm vào danh sách của mình
    [HttpPost("tracks")]
    [RequestSizeLimit(MaxFileBytes + 1024 * 1024)]
    public async Task<ActionResult<TrackDto>> Upload(
        IFormFile file,
        [FromForm] string? title,
        [FromForm] string? artist,
        [FromForm] int? durationSeconds)
    {
        var me = User.GetUserId();

        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Chưa chọn file nhạc." });
        if (file.Length > MaxFileBytes)
            return BadRequest(new { message = $"File quá lớn (tối đa {MaxFileBytes / 1024 / 1024} MB)." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!AllowedTypes.TryGetValue(ext, out var contentType))
            return BadRequest(new { message = "Chỉ nhận file mp3, m4a, ogg, wav, flac." });
        if (!await LooksLikeAudioAsync(file, ext))
            return BadRequest(new { message = "File không phải âm thanh hợp lệ." });

        // mã băm để nhận ra file trùng trong kho
        string hash;
        await using (var hs = file.OpenReadStream())
        {
            hash = Convert.ToHexString(await SHA256.HashDataAsync(hs)).ToLowerInvariant();
        }

        var existing = await _db.Tracks.FirstOrDefaultAsync(t => t.ContentHash == hash);
        if (existing is not null)
        {
            await EnsureLinkAsync(me, existing.Id); // đã có trong kho: chỉ thêm vào danh sách của mình
            return Ok(ToDto(existing));
        }

        var total = await _db.Tracks.SumAsync(t => (long?)t.SizeBytes) ?? 0;
        if (total + file.Length > MusicLimits.LibraryQuotaBytes)
            return BadRequest(new { message = $"Kho nhạc chung đã đầy (tối đa {MusicLimits.LibraryQuotaBytes / 1024 / 1024 / 1024} GB)." });

        var name = Clip((title ?? "").Trim(), 150);
        if (name.Length == 0) name = Clip(Path.GetFileNameWithoutExtension(file.FileName).Trim(), 150);
        if (name.Length == 0) name = "Không tên";

        var artistName = Clip((artist ?? "").Trim(), 100);

        // tên ngẫu nhiên trên R2, không dùng tên gốc
        var key = $"music/{Guid.NewGuid():N}{ext}";
        await using (var stream = file.OpenReadStream())
        {
            await _r2.UploadAsync(key, stream, contentType);
        }

        var track = new Track
        {
            UploaderId = me,
            Title = name,
            Artist = artistName.Length == 0 ? null : artistName,
            DurationSeconds = durationSeconds is > 0 and <= 86400 ? durationSeconds : null,
            ObjectKey = key,
            ContentType = contentType,
            SizeBytes = file.Length,
            Origin = TrackOrigin.Upload,
            ContentHash = hash
        };
        _db.Tracks.Add(track);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            await _r2.DeleteAsync(new[] { key }); // không để file mồ côi trên R2
            _db.ChangeTracker.Clear();

            // hai người up cùng một file cùng lúc: bản kia thắng, dùng bản đó
            var dup = await _db.Tracks.FirstOrDefaultAsync(t => t.ContentHash == hash);
            if (dup is null) throw;
            await EnsureLinkAsync(me, dup.Id);
            return Ok(ToDto(dup));
        }
        catch
        {
            await _r2.DeleteAsync(new[] { key });
            throw;
        }

        await EnsureLinkAsync(me, track.Id);
        return Ok(ToDto(track));
    }

    // Link phát có hạn cho một bài nằm trong danh sách của mình
    [HttpGet("tracks/{id:int}/url")]
    public async Task<ActionResult<TrackUrlDto>> GetUrl(int id)
    {
        var me = User.GetUserId();

        var key = await _db.Tracks
            .Where(t => t.Id == id && _db.UserTracks.Any(u => u.UserId == me && u.TrackId == t.Id))
            .Select(t => t.ObjectKey)
            .FirstOrDefaultAsync();
        if (key is null)
            return NotFound(new { message = "Không tìm thấy bài hát." });

        return Ok(new TrackUrlDto { Url = _r2.GetDownloadUrl(key, lifetime: LinkLifetime) });
    }

    // Bỏ bài khỏi danh sách của mình; không còn ai dùng thì xoá luôn bài và file trên R2
    [HttpDelete("tracks/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var me = User.GetUserId();

        var link = await _db.UserTracks.FirstOrDefaultAsync(u => u.UserId == me && u.TrackId == id);
        if (link is null)
            return NotFound(new { message = "Không tìm thấy bài hát." });

        _db.UserTracks.Remove(link);
        await _db.SaveChangesAsync();

        var stillUsed = await _db.UserTracks.AnyAsync(u => u.TrackId == id);
        if (!stillUsed)
        {
            var track = await _db.Tracks.FirstOrDefaultAsync(t => t.Id == id);
            if (track is not null)
            {
                var key = track.ObjectKey;
                _db.Tracks.Remove(track);
                await _db.SaveChangesAsync();
                await _r2.DeleteAsync(new[] { key }); // xoá R2 sau khi database đã lưu xong
            }
        }

        return NoContent();
    }

    // Thêm một bài trong kho chung vào danh sách của mình
    [HttpPost("tracks/{id:int}/add")]
    public async Task<IActionResult> AddToMine(int id)
    {
        var me = User.GetUserId();

        if (!await _db.Tracks.AnyAsync(t => t.Id == id))
            return NotFound(new { message = "Không tìm thấy bài hát." });

        await EnsureLinkAsync(me, id);
        return NoContent();
    }

    // Tìm bài theo tên trên YouTube: trả tối đa 5 kết quả để người dùng chọn
    [HttpGet("search")]
    public async Task<ActionResult<List<SearchResultDto>>> Search([FromQuery] string? q, CancellationToken ct)
    {
        var term = new string((q ?? "").Where(c => !char.IsControl(c)).ToArray()).Trim();
        if (term.Length < 2)
            return BadRequest(new { message = "Gõ ít nhất 2 ký tự để tìm." });
        if (term.Length > 100) term = term[..100];

        try
        {
            return Ok(await _search.SearchAsync(term, ct));
        }
        catch (ImportException ex)
        {
            return BadRequest(new { message = ex.Message });
        }
    }

    // Bắt đầu nhập một bài từ link: trả về ngay, việc tải chạy nền
    [HttpPost("imports")]
    public async Task<ActionResult<ImportDto>> StartImport(ImportRequest req)
    {
        var me = User.GetUserId();

        if (!ImportUrlValidator.TryNormalize(req.Url, out var url))
            return BadRequest(new { message = "Chỉ nhận link YouTube (youtube.com, youtu.be)." });

        var libraryUsed = await _db.Tracks.SumAsync(t => (long?)t.SizeBytes) ?? 0;
        if (libraryUsed >= MusicLimits.LibraryQuotaBytes)
            return BadRequest(new { message = "Kho nhạc chung đã đầy." });

        var active = await _db.TrackImports
            .Where(i => i.OwnerId == me && i.Status != ImportStatus.Failed)
            .Select(i => i.Url)
            .ToListAsync();
        if (active.Contains(url))
            return BadRequest(new { message = "Link này đang được xử lý." });
        if (active.Count >= MaxActiveImports)
            return BadRequest(new { message = $"Bạn đang có {MaxActiveImports} bài đang nhập, hãy chờ xong rồi thêm tiếp." });

        var imp = new TrackImport { OwnerId = me, Url = url };
        _db.TrackImports.Add(imp);
        await _db.SaveChangesAsync();

        _queue.Enqueue(imp.Id);
        return Accepted(ToImportDto(imp));
    }

    // Các lần nhập đang chạy hoặc bị lỗi của mình (nhập xong thì biến mất, bài nằm trong thư viện)
    [HttpGet("imports")]
    public async Task<ActionResult<List<ImportDto>>> ListImports()
    {
        var me = User.GetUserId();

        var rows = await _db.TrackImports
            .Where(i => i.OwnerId == me)
            .OrderByDescending(i => i.Id)
            .ToListAsync();

        return Ok(rows.Select(ToImportDto).ToList());
    }

    // Bỏ một lần nhập bị lỗi khỏi danh sách
    [HttpDelete("imports/{id:int}")]
    public async Task<IActionResult> DismissImport(int id)
    {
        var me = User.GetUserId();

        var imp = await _db.TrackImports.FirstOrDefaultAsync(i => i.Id == id && i.OwnerId == me);
        if (imp is null)
            return NotFound(new { message = "Không tìm thấy lần nhập này." });
        if (imp.Status != ImportStatus.Failed)
            return BadRequest(new { message = "Bài này đang được xử lý, chưa thể bỏ." });

        _db.TrackImports.Remove(imp);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    // ---------- Hàm dùng chung ----------

    private static ImportDto ToImportDto(TrackImport i) => new()
    {
        Id = i.Id,
        Url = i.Url,
        Title = i.Title,
        Status = i.Status.ToString().ToLowerInvariant(),
        Error = i.Error,
        CreatedAt = i.CreatedAt
    };

    private static TrackDto ToDto(Track t) => new()
    {
        Id = t.Id,
        Title = t.Title,
        Artist = t.Artist,
        DurationSeconds = t.DurationSeconds,
        SizeBytes = t.SizeBytes,
        CreatedAt = t.CreatedAt,
        UploaderId = t.UploaderId,
        Origin = t.Origin,
        InLibrary = true
    };

    // Thêm bài vào danh sách của người dùng (đã có rồi thì bỏ qua)
    private async Task EnsureLinkAsync(int userId, int trackId)
    {
        if (await _db.UserTracks.AnyAsync(u => u.UserId == userId && u.TrackId == trackId))
            return;

        _db.UserTracks.Add(new UserTrack { UserId = userId, TrackId = trackId });
        try
        {
            await _db.SaveChangesAsync();
        }
        catch (DbUpdateException)
        {
            _db.ChangeTracker.Clear(); // bấm hai lần cùng lúc: dòng liên kết đã có, bỏ qua
        }
    }

    private static string Clip(string s, int max) => s.Length <= max ? s : s[..max];

    // Kiểm tra vài byte đầu file có đúng định dạng âm thanh không, tránh đổi đuôi file khác thành .mp3
    private static async Task<bool> LooksLikeAudioAsync(IFormFile file, string ext)
    {
        var h = new byte[12];
        await using var s = file.OpenReadStream();
        var n = await s.ReadAsync(h, 0, h.Length);
        if (n < 12) return false;

        return ext switch
        {
            ".mp3" => (h[0] == 'I' && h[1] == 'D' && h[2] == '3') || (h[0] == 0xFF && (h[1] & 0xE0) == 0xE0),
            ".m4a" => h[4] == 'f' && h[5] == 't' && h[6] == 'y' && h[7] == 'p',
            ".ogg" => h[0] == 'O' && h[1] == 'g' && h[2] == 'g' && h[3] == 'S',
            ".wav" => h[0] == 'R' && h[1] == 'I' && h[2] == 'F' && h[3] == 'F'
                      && h[8] == 'W' && h[9] == 'A' && h[10] == 'V' && h[11] == 'E',
            ".flac" => h[0] == 'f' && h[1] == 'L' && h[2] == 'a' && h[3] == 'C',
            _ => false
        };
    }
}