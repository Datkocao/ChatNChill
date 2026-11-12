using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Hubs;
using ChatAndChill.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

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
    private readonly IWebHostEnvironment _env;
    private readonly IHubContext<ChatHub> _hub;

    public ProfileController(AppDbContext db, IWebHostEnvironment env, IHubContext<ChatHub> hub)
    {
        _db = db;
        _env = env;
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

    // ---------- Hàm dùng chung ----------

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
        if (!ImageExts.Contains(ext))
            return BadRequest(new { message = "Chỉ nhận ảnh jpg, png, gif, webp." });

        // lưu với tên ngẫu nhiên, không dùng tên gốc
        var folder = Path.Combine(_env.ContentRootPath, "uploads", folderName);
        Directory.CreateDirectory(folder);
        var stored = $"{Guid.NewGuid():N}{ext}";
        await using (var stream = System.IO.File.Create(Path.Combine(folder, stored)))
        {
            await file.CopyToAsync(stream);
        }

        var oldUrl = isAvatar ? user.AvatarUrl : user.CoverUrl;
        var newUrl = $"/uploads/{folderName}/{stored}";
        if (isAvatar) user.AvatarUrl = newUrl;
        else user.CoverUrl = newUrl;

        await _db.SaveChangesAsync();
        DeleteOldFile(folder, oldUrl); // dọn ảnh cũ để không đầy ổ đĩa
        await _db.SaveChangesAsync();
        DeleteOldFile(folder, oldUrl); // dọn ảnh cũ để không đầy ổ đĩa
        if (isAvatar) await NotifyProfileChangedAsync(user);   // THÊM dòng này

        return Ok(ToDto(user));
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

    private static void DeleteOldFile(string folder, string? oldUrl)
    {
        if (string.IsNullOrEmpty(oldUrl)) return;
        try
        {
            // chỉ lấy phần tên file để không thoát ra khỏi thư mục
            var path = Path.Combine(folder, Path.GetFileName(oldUrl));
            if (System.IO.File.Exists(path)) System.IO.File.Delete(path);
        }
        catch
        {
            // xoá không được cũng không sao
        }
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