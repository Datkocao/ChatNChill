using System.Text.RegularExpressions;
using ChatAndChill.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using ChatAndChill.Data;
using ChatAndChill.Extensions;
using ChatAndChill.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Controllers;

// Ảnh nền / ảnh bìa của theme trình phát, lưu trên R2 với key themes/{guid}{đuôi}
[ApiController]
[Authorize]
[Route("api/theme-images")]
public class ThemeImagesController : ControllerBase
{
    private const long MaxBytes = 5 * 1024 * 1024; // 5 MB
    private const int MaxImagesPerUser = 20;

    private static readonly HashSet<string> ImageExts =
        new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".gif", ".webp" };

    // Chỉ chấp nhận đúng dạng tên do server tự sinh. Endpoint GET mở công khai nên
    // bắt buộc khoá chặt tên để không ai lấy được file khác trên bucket (ví dụ attachments/...).
    private static readonly Regex NamePattern =
        new(@"^[0-9a-f]{32}\.(jpg|jpeg|png|gif|webp)$", RegexOptions.Compiled);

    private readonly R2StorageService _r2;
    private readonly AppDbContext _db;

    public ThemeImagesController(R2StorageService r2, AppDbContext db)
    {
        _r2 = r2;
        _db = db;
    }


    // Tải ảnh lên, trả về đường dẫn tương đối để lưu vào theme
    [HttpPost]
    [RequestSizeLimit(MaxBytes + 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile? file)
    {
        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Chưa chọn ảnh." });
        if (file.Length > MaxBytes)
            return BadRequest(new { message = $"Ảnh quá lớn (tối đa {MaxBytes / 1024 / 1024} MB)." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!ImageExts.Contains(ext) || !await LooksLikeImageAsync(file))
            return BadRequest(new { message = "Chỉ nhận ảnh jpg, png, gif, webp." });

        var userId = User.GetUserId();
        if (await _db.ThemeImages.CountAsync(i => i.OwnerId == userId) >= MaxImagesPerUser)
            return BadRequest(new { message = $"Bạn đã có {MaxImagesPerUser} ảnh theme. Bấm \"Lưu giao diện\" để dọn ảnh không dùng rồi thử lại." });

        // tên ngẫu nhiên, không dùng tên gốc
        var name = $"{Guid.NewGuid():N}{ext}";
        await using (var stream = file.OpenReadStream())
        {
            await _r2.UploadAsync($"themes/{name}", stream, ContentTypeFor(ext));
        }

        _db.ThemeImages.Add(new ThemeImage { Name = name, OwnerId = userId });
        try
        {
            await _db.SaveChangesAsync();
        }
        catch
        {
            await _r2.DeleteAsync(new[] { $"themes/{name}" }); // không để ảnh mồ côi trên R2
            throw;
        }

        return Ok(new { url = $"/api/theme-images/{name}" });
    }

    // Trả ảnh ra cho thẻ <img> và CSS url(): không gửi được token nên phải mở công khai
    [AllowAnonymous]
    [HttpGet("{name}")]
    public async Task<IActionResult> Get(string name)
    {
        if (!NamePattern.IsMatch(name)) return NotFound();

        var file = await _r2.DownloadAsync($"themes/{name}");
        if (file is null) return NotFound();

        // tên file là guid nên không bao giờ đổi nội dung, cache lâu được
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(file.Value.Stream, ContentTypeFor(Path.GetExtension(name)));
    }

    private static string ContentTypeFor(string ext) => ext.ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        _ => "application/octet-stream"
    };

    // Kiểm tra vài byte đầu file có đúng là ảnh không (giống ProfileController)
    private static async Task<bool> LooksLikeImageAsync(IFormFile file)
    {
        var h = new byte[12];
        await using var s = file.OpenReadStream();
        var n = await s.ReadAsync(h, 0, h.Length);
        if (n < 12) return false;

        var jpg = h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF;
        var png = h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47;
        var gif = h[0] == 0x47 && h[1] == 0x49 && h[2] == 0x46 && h[3] == 0x38;
        var webp = h[0] == 0x52 && h[1] == 0x49 && h[2] == 0x46 && h[3] == 0x46
                && h[8] == 0x57 && h[9] == 0x45 && h[10] == 0x42 && h[11] == 0x50;
        return jpg || png || gif || webp;
    }
}