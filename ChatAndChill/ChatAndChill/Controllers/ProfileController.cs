using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Hubs;
using ChatAndChill.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using ChatAndChill.Services;

namespace ChatAndChill.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class ProfileController : ControllerBase
{
    private const long MaxAvatarBytes = 5 * 1024 * 1024; // 5 MB
    private const long MaxCoverBytes = 8 * 1024 * 1024;  // 8 MB
    private const int MaxDisplayName = 50;
    private const int MaxBio = 300;

    private static readonly HashSet<string> ImageExts =
        new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".gif", ".webp" };

    private readonly AppDbContext _db;
    private readonly R2StorageService _r2;
    private readonly IHubContext<ChatHub> _hub;

    public ProfileController(AppDbContext db, R2StorageService r2, IHubContext<ChatHub> hub)
    {
        _db = db;
        _r2 = r2;
        _hub = hub;
    }


    // Hồ sơ của chính mình
    [HttpGet("me")]
    public async Task<ActionResult<ProfileDto>> GetMine()
    {
        var user = await _db.Users.FindAsync(User.GetUserId());
        if (user is null) return NotFound();
        return Ok(ToDto(user));
    }

    // Xem hồ sơ người khác (đã đăng nhập là xem được)
    [HttpGet("{userId:int}")]
    public async Task<ActionResult<ProfileDto>> GetOne(int userId)
    {
        var user = await _db.Users.FindAsync(userId);
        if (user is null)
            return NotFound(new { message = "Không tìm thấy người dùng." });
        return Ok(ToDto(user));
    }

    // Sửa tên hiển thị và bio
    [HttpPut("me")]
    public async Task<ActionResult<ProfileDto>> Update(UpdateProfileRequest req)
    {
        var user = await _db.Users.FindAsync(User.GetUserId());
        if (user is null) return NotFound();

        var displayName = (req.DisplayName ?? "").Trim();
        if (displayName.Length == 0)
            return BadRequest(new { message = "Tên hiển thị không được để trống." });
        if (displayName.Length > MaxDisplayName)
            return BadRequest(new { message = $"Tên hiển thị tối đa {MaxDisplayName} ký tự." });

        var bio = (req.Bio ?? "").Trim();
        if (bio.Length > MaxBio)
            return BadRequest(new { message = $"Tiểu sử tối đa {MaxBio} ký tự." });

        user.DisplayName = displayName;
        user.Bio = bio.Length == 0 ? null : bio;
        await _db.SaveChangesAsync();
        await NotifyProfileChangedAsync(user);

        return Ok(ToDto(user));
    }

    [HttpPost("avatar")]
    [RequestSizeLimit(MaxAvatarBytes + 1024 * 1024)]
    public Task<ActionResult<ProfileDto>> UploadAvatar(IFormFile file) =>
        SaveImageAsync(file, "avatars", MaxAvatarBytes, isAvatar: true);

    [HttpPost("cover")]
    [RequestSizeLimit(MaxCoverBytes + 1024 * 1024)]
    public Task<ActionResult<ProfileDto>> UploadCover(IFormFile file) =>
        SaveImageAsync(file, "covers", MaxCoverBytes, isAvatar: false);


    // Ảnh hồ sơ cho thẻ <img>: thẻ này không gửi được token nên endpoint phải mở công khai
    [AllowAnonymous]
    [HttpGet("{userId:int}/avatar")]
    public Task<IActionResult> GetAvatar(int userId) => ServeImageAsync(userId, isAvatar: true);

    [AllowAnonymous]
    [HttpGet("{userId:int}/cover")]
    public Task<IActionResult> GetCover(int userId) => ServeImageAsync(userId, isAvatar: false);

    // ---------- Hàm dùng chung ----------

    private async Task<IActionResult> ServeImageAsync(int userId, bool isAvatar)
    {
        var keys = await _db.Users
            .Where(u => u.Id == userId)
            .Select(u => new { u.AvatarKey, u.CoverKey })
            .FirstOrDefaultAsync();

        var key = isAvatar ? keys?.AvatarKey : keys?.CoverKey;
        if (string.IsNullOrEmpty(key)) return NotFound();

        var file = await _r2.DownloadAsync(key);
        if (file is null) return NotFound();

        // đường dẫn có ?v=tên-file nên mỗi lần đổi ảnh là một URL mới, cache lâu được
        Response.Headers.CacheControl = "public, max-age=31536000, immutable";
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        return File(file.Value.Stream, file.Value.ContentType);
    }
    private async Task<ActionResult<ProfileDto>> SaveImageAsync(
     IFormFile? file, string folderName, long maxBytes, bool isAvatar)
    {
        var user = await _db.Users.FindAsync(User.GetUserId());
        if (user is null) return NotFound();

        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Chưa chọn ảnh." });
        if (file.Length > maxBytes)
            return BadRequest(new { message = $"Ảnh quá lớn (tối đa {maxBytes / 1024 / 1024} MB)." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!ImageExts.Contains(ext) || !await LooksLikeImageAsync(file))
            return BadRequest(new { message = "Chỉ nhận ảnh jpg, png, gif, webp." });

        // tên ngẫu nhiên, không dùng tên gốc
        var newKey = $"{folderName}/{Guid.NewGuid():N}{ext}";
        await using (var stream = file.OpenReadStream())
        {
            await _r2.UploadAsync(newKey, stream, ContentTypeFor(ext));
        }

        var oldKey = isAvatar ? user.AvatarKey : user.CoverKey;
        if (isAvatar)
        {
            user.AvatarKey = newKey;
            user.AvatarUrl = ProfileUrls.Avatar(user.Id, newKey);
        }
        else
        {
            user.CoverKey = newKey;
            user.CoverUrl = ProfileUrls.Cover(user.Id, newKey);
        }

        try
        {
            await _db.SaveChangesAsync();
        }
        catch
        {
            await _r2.DeleteAsync(new[] { newKey }); // không để ảnh mồ côi trên R2
            throw;
        }

        if (!string.IsNullOrEmpty(oldKey))
            await _r2.DeleteAsync(new[] { oldKey }); // dọn ảnh cũ

        if (isAvatar) await NotifyProfileChangedAsync(user);
        return Ok(ToDto(user));
    }

    private static string ContentTypeFor(string ext) => ext switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        _ => "application/octet-stream"
    };

    // Kiểm tra vài byte đầu file có đúng là ảnh không, tránh đổi đuôi file khác thành .jpg
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


    // Báo cho bạn bè, người chung cuộc trò chuyện (và các tab khác của mình) biết hồ sơ vừa đổi
    private async Task NotifyProfileChangedAsync(User user)
    {
        var chatMates = await _db.ConversationMembers
            .Where(m => m.UserId != user.Id
                && _db.ConversationMembers.Any(x => x.ConversationId == m.ConversationId && x.UserId == user.Id))
            .Select(m => m.UserId)
            .ToListAsync();

        var friends = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Accepted
                        && (f.RequesterId == user.Id || f.AddresseeId == user.Id))
            .Select(f => f.RequesterId == user.Id ? f.AddresseeId : f.RequesterId)
            .ToListAsync();

        var groups = chatMates.Union(friends).Append(user.Id).Distinct()
            .Select(ChatHub.UserGroup).ToList();

        await _hub.Clients.Groups(groups).SendAsync("ProfileChanged", new
        {
            userId = user.Id,
            displayName = user.DisplayName ?? user.Username,
            avatarUrl = user.AvatarUrl
        });
    }

    private static ProfileDto ToDto(User u) => new()
    {
        UserId = u.Id,
        Username = u.Username,
        DisplayName = u.DisplayName,
        AvatarUrl = u.AvatarUrl,
        CoverUrl = u.CoverUrl,
        Bio = u.Bio,
        CreatedAt = u.CreatedAt
    };
}   