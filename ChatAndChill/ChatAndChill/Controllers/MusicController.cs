using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Models;
using ChatAndChill.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class MusicController : ControllerBase
{
    private const long MaxFileBytes = 30L * 1024 * 1024;  // 30 MB mỗi bài
    private const long QuotaBytes = 200L * 1024 * 1024;   // 200 MB mỗi người
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

    public MusicController(AppDbContext db, R2StorageService r2)
    {
        _db = db;
        _r2 = r2;
    }

    // Thư viện nhạc của mình + dung lượng đã dùng
    [HttpGet("tracks")]
    public async Task<ActionResult<TrackListDto>> List()
    {
        var me = User.GetUserId();

        var tracks = await _db.Tracks
            .Where(t => t.OwnerId == me)
            .OrderByDescending(t => t.Id)
            .Select(t => new TrackDto
            {
                Id = t.Id,
                Title = t.Title,
                Artist = t.Artist,
                DurationSeconds = t.DurationSeconds,
                SizeBytes = t.SizeBytes,
                CreatedAt = t.CreatedAt
            })
            .ToListAsync();

        return Ok(new TrackListDto
        {
            Tracks = tracks,
            UsedBytes = tracks.Sum(t => t.SizeBytes),
            QuotaBytes = QuotaBytes
        });
    }

    // Upload một bài lên R2
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

        var used = await _db.Tracks
            .Where(t => t.OwnerId == me)
            .SumAsync(t => (long?)t.SizeBytes) ?? 0;
        if (used + file.Length > QuotaBytes)
            return BadRequest(new { message = $"Thư viện nhạc đã đầy (tối đa {QuotaBytes / 1024 / 1024} MB). Hãy xoá bớt bài." });

        var name = Clip((title ?? "").Trim(), 150);
        if (name.Length == 0) name = Clip(Path.GetFileNameWithoutExtension(file.FileName).Trim(), 150);
        if (name.Length == 0) name = "Không tên";

        var artistName = Clip((artist ?? "").Trim(), 100);

        // tên ngẫu nhiên trên R2, không dùng tên gốc
        var key = $"music/{me}/{Guid.NewGuid():N}{ext}";
        await using (var stream = file.OpenReadStream())
        {
            await _r2.UploadAsync(key, stream, contentType);
        }

        var track = new Track
        {
            OwnerId = me,
            Title = name,
            Artist = artistName.Length == 0 ? null : artistName,
            DurationSeconds = durationSeconds is > 0 and <= 86400 ? durationSeconds : null,
            ObjectKey = key,
            ContentType = contentType,
            SizeBytes = file.Length
        };
        _db.Tracks.Add(track);

        try
        {
            await _db.SaveChangesAsync();
        }
        catch
        {
            await _r2.DeleteAsync(new[] { key }); // không để file mồ côi trên R2
            throw;
        }

        return Ok(ToDto(track));
    }

    // Link phát có hạn cho một bài của mình
    [HttpGet("tracks/{id:int}/url")]
    public async Task<ActionResult<TrackUrlDto>> GetUrl(int id)
    {
        var me = User.GetUserId();

        var key = await _db.Tracks
            .Where(t => t.Id == id && t.OwnerId == me)
            .Select(t => t.ObjectKey)
            .FirstOrDefaultAsync();
        if (key is null)
            return NotFound(new { message = "Không tìm thấy bài hát." });

        return Ok(new TrackUrlDto { Url = _r2.GetDownloadUrl(key, lifetime: LinkLifetime) });
    }

    // Xoá bài (cả dòng trong database lẫn file trên R2)
    [HttpDelete("tracks/{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var me = User.GetUserId();

        var track = await _db.Tracks.FirstOrDefaultAsync(t => t.Id == id && t.OwnerId == me);
        if (track is null)
            return NotFound(new { message = "Không tìm thấy bài hát." });

        var key = track.ObjectKey;
        _db.Tracks.Remove(track);
        await _db.SaveChangesAsync();
        await _r2.DeleteAsync(new[] { key }); // xoá R2 sau khi database đã lưu xong

        return NoContent();
    }

    // ---------- Hàm dùng chung ----------

    private static TrackDto ToDto(Track t) => new()
    {
        Id = t.Id,
        Title = t.Title,
        Artist = t.Artist,
        DurationSeconds = t.DurationSeconds,
        SizeBytes = t.SizeBytes,
        CreatedAt = t.CreatedAt
    };

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