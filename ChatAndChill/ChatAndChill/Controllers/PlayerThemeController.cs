using System.Text.Json;
using ChatAndChill.Data;
using ChatAndChill.Extensions;
using ChatAndChill.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Controllers;

[ApiController]
[Authorize]
[Route("api/player-theme")]
public class PlayerThemeController : ControllerBase
{
    private const string ImagePrefix = "/api/theme-images/";
    private static readonly JsonSerializerOptions JsonOpts = new(JsonSerializerDefaults.Web);

    private readonly AppDbContext _db;
    private readonly R2StorageService _r2;

    public PlayerThemeController(AppDbContext db, R2StorageService r2)
    {
        _db = db;
        _r2 = r2;
    }

    // Theme của mình. theme = null nghĩa là chưa từng lưu lên server
    [HttpGet("me")]
    public Task<IActionResult> GetMine() => GetFor(User.GetUserId());

    // Xem theme người khác (đã đăng nhập là xem được)
    [HttpGet("{userId:int}")]
    public Task<IActionResult> GetOne(int userId) => GetFor(userId);

    [HttpPut("me")]
    [RequestSizeLimit(16 * 1024)]
    public async Task<IActionResult> Save([FromBody] JsonElement raw)
    {
        var userId = User.GetUserId();
        var user = await _db.Users.FindAsync(userId);
        if (user is null) return NotFound();

        var mine = await _db.ThemeImages.Where(i => i.OwnerId == userId).ToListAsync();
        var theme = PlayerThemeSanitizer.Sanitize(raw, mine.Select(i => i.Name).ToHashSet());
        user.PlayerThemeJson = JsonSerializer.Serialize(theme, JsonOpts);

        // ảnh của mình không còn được theme dùng thì xoá (DB trước, R2 sau)
        var used = new HashSet<string>();
        if (theme.BgImage is not null) used.Add(theme.BgImage[ImagePrefix.Length..]);
        if (theme.CoverImage is not null) used.Add(theme.CoverImage[ImagePrefix.Length..]);
        var unused = mine.Where(i => !used.Contains(i.Name)).ToList();
        _db.ThemeImages.RemoveRange(unused);

        await _db.SaveChangesAsync();
        await _r2.DeleteAsync(unused.Select(i => $"themes/{i.Name}"));

        // trả lại bản đã kiểm tra để frontend dùng đúng bản server đã lưu
        return Ok(new { theme });
    }

    private async Task<IActionResult> GetFor(int userId)
    {
        var row = await _db.Users
            .Where(u => u.Id == userId)
            .Select(u => new { u.PlayerThemeJson })
            .FirstOrDefaultAsync();
        if (row is null)
            return NotFound(new { message = "Không tìm thấy người dùng." });
        if (string.IsNullOrEmpty(row.PlayerThemeJson))
            return Ok(new { theme = (object?)null });

        try
        {
            return Ok(new { theme = JsonSerializer.Deserialize<JsonElement>(row.PlayerThemeJson) });
        }
        catch (JsonException)
        {
            return Ok(new { theme = (object?)null }); // dữ liệu hỏng thì coi như chưa có
        }
    }
}