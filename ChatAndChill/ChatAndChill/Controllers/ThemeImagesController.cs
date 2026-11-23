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
        if (!ImageFiles.Extensions.Contains(ext) || !await ImageFiles.LooksLikeImageAsync(file))
            return BadRequest(new { message = "Chỉ nhận ảnh jpg, png, gif, webp." });

        var userId = User.GetUserId();
        if (await _db.ThemeImages.CountAsync(i => i.OwnerId == userId) >= MaxImagesPerUser)
            return BadRequest(new { message = $"Bạn đã có {MaxImagesPerUser} ảnh theme. Bấm \"Lưu giao diện\" để dọn ảnh không dùng rồi thử lại." });

        // tên ngẫu nhiên, không dùng tên gốc
        var name = $"{Guid.NewGuid():N}{ext}";
        await using (var stream = file.OpenReadStream())
        {
            await _r2.UploadAsync($"themes/{name}", stream, ImageFiles.ContentTypeFor(ext));
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
        return File(file.Value.Stream, ImageFiles.ContentTypeFor(Path.GetExtension(name)));
    }


  
}