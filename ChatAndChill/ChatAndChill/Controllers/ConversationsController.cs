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
public class ConversationsController : ControllerBase
{
    private const int MaxGroupMembers = 50;
    private const long MaxUploadBytes = 10 * 1024 * 1024; // 10 MB

    private static readonly Dictionary<string, string> AllowedTypes =
        new(StringComparer.OrdinalIgnoreCase)
        {
            // ảnh
            [".jpg"] = "image/jpeg",
            [".jpeg"] = "image/jpeg",
            [".png"] = "image/png",
            [".gif"] = "image/gif",
            [".webp"] = "image/webp",
            // file thường
            [".pdf"] = "application/pdf",
            [".txt"] = "text/plain",
            [".zip"] = "application/zip",
            [".doc"] = "application/msword",
            [".docx"] = "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            [".xls"] = "application/vnd.ms-excel",
            [".xlsx"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            [".ppt"] = "application/vnd.ms-powerpoint",
            [".pptx"] = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            [".mp3"] = "audio/mpeg",
        };

    private readonly AppDbContext _db;
    private readonly IHubContext<ChatHub> _hub;

    public ConversationsController(AppDbContext db, IHubContext<ChatHub> hub)
    {
        _db = db;
        _hub = hub;
    }

    // ---------- Chat 1-1 ----------

    [HttpPost("direct")]
    public async Task<ActionResult<ConversationDto>> StartDirect(StartDirectRequest req)
    {
        var me = User.GetUserId();
        var username = req.Username.Trim().ToLowerInvariant();

        var other = await _db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (other is null)
            return NotFound(new { message = "Không tìm thấy người dùng." });
        if (other.Id == me)
            return BadRequest(new { message = "Không thể nhắn tin cho chính mình." });

        var conv = await _db.Conversations
            .Where(c => c.Type == ConversationType.Direct
                        && c.Members.Any(m => m.UserId == me)
                        && c.Members.Any(m => m.UserId == other.Id))
            .FirstOrDefaultAsync();

        if (conv is null)
        {
            if ((await NonFriendsAsync(me, new[] { other })).Count > 0)
                return Deny("Hai bạn chưa là bạn bè. Hãy kết bạn trước khi nhắn tin.");
            conv = new Conversation { Type = ConversationType.Direct };
            conv.Members.Add(new ConversationMember { UserId = me });
            conv.Members.Add(new ConversationMember { UserId = other.Id });
            _db.Conversations.Add(conv);
            await _db.SaveChangesAsync();
        }

        return Ok(new ConversationDto
        {
            Id = conv.Id,
            Type = "direct",
            Name = other.DisplayName ?? other.Username,
            MemberCount = 2,
            OtherUserId = other.Id,
            OtherAvatarUrl = other.AvatarUrl
        });
    }

    // ---------- Danh sách và lịch sử ----------

    [HttpGet]
    public async Task<ActionResult<List<ConversationDto>>> GetMine()
    {
        var me = User.GetUserId();

        var rows = await _db.Conversations
            .Where(c => c.Members.Any(m => m.UserId == me))
            .Select(c => new
            {
                c.Id,
                c.Type,
                c.Name,
                MemberCount = c.Members.Count,
                IsAdmin = c.Members.Any(m => m.UserId == me && m.Role == MemberRole.Admin),
                OtherName = c.Members
                    .Where(m => m.UserId != me)
                    .Select(m => m.User.DisplayName ?? m.User.Username)
                    .FirstOrDefault(),
                OtherUserId = c.Members
                    .Where(m => m.UserId != me)
                    .Select(m => (int?)m.UserId)
                    .FirstOrDefault(),
                OtherAvatarUrl = c.Members
                    .Where(m => m.UserId != me)
                    .Select(m => m.User.AvatarUrl)
                    .FirstOrDefault(),
                Last = c.Messages
                    .OrderByDescending(x => x.Id)
                    .Select(x => new MessageDto
                    {
                        Id = x.Id,
                        ConversationId = x.ConversationId,
                        SenderId = x.SenderId,
                        SenderName = x.Sender.DisplayName ?? x.Sender.Username,
                        SenderAvatarUrl = x.Sender.AvatarUrl,
                        Content = x.Content,
                        CreatedAt = x.CreatedAt,
                        AttachmentUrl = x.AttachmentPath == null ? null : "/uploads/" + x.AttachmentPath,
                        AttachmentName = x.AttachmentName,
                        AttachmentContentType = x.AttachmentContentType,
                        AttachmentSize = x.AttachmentSize
                    })
                    .FirstOrDefault()
            })
            .ToListAsync();

        var result = rows
            .OrderByDescending(r => r.Last?.CreatedAt ?? DateTime.MinValue)
            .Select(r => new ConversationDto
            {
                Id = r.Id,
                Type = r.Type == ConversationType.Direct ? "direct" : "group",
                Name = r.Type == ConversationType.Direct
                    ? (r.OtherName ?? "Không rõ")
                    : (r.Name ?? "Nhóm"),
                MemberCount = r.MemberCount,
                IsAdmin = r.IsAdmin,
                OtherUserId = r.Type == ConversationType.Direct ? r.OtherUserId : null,
                OtherAvatarUrl = r.Type == ConversationType.Direct ? r.OtherAvatarUrl : null,
                LastMessage = r.Last
            })
            .ToList();

        return Ok(result);
    }

    [HttpGet("{id:int}/messages")]
    public async Task<ActionResult<List<MessageDto>>> GetMessages(
        int id, [FromQuery] long? before, [FromQuery] int limit = 30)
    {
        var me = User.GetUserId();
        if (!await IsMemberAsync(id, me)) return Forbid();

        limit = Math.Clamp(limit, 1, 100);

        var query = _db.Messages.Where(m => m.ConversationId == id);
        if (before is not null)
            query = query.Where(m => m.Id < before);

        var items = await query
            .OrderByDescending(m => m.Id)
            .Take(limit)
            .Select(m => new MessageDto
            {
                Id = m.Id,
                ConversationId = m.ConversationId,
                SenderId = m.SenderId,
                SenderName = m.Sender.DisplayName ?? m.Sender.Username,
                SenderAvatarUrl = m.Sender.AvatarUrl,
                Content = m.Content,
                CreatedAt = m.CreatedAt,
                AttachmentUrl = m.AttachmentPath == null ? null : "/uploads/" + m.AttachmentPath,
                AttachmentName = m.AttachmentName,
                AttachmentContentType = m.AttachmentContentType,
                AttachmentSize = m.AttachmentSize
            })
            .ToListAsync();

        items.Reverse();
        return Ok(items);
    }


    // Ai đã đọc tới tin nào (dùng khi mở cuộc trò chuyện)
    [HttpGet("{id:int}/reads")]
    public async Task<ActionResult> GetReads(int id)
    {
        var me = User.GetUserId();
        if (!await IsMemberAsync(id, me)) return Forbid();

        var reads = await _db.ConversationMembers
            .Where(m => m.ConversationId == id && m.UserId != me)
            .Select(m => new { userId = m.UserId, lastReadMessageId = m.LastReadMessageId })
            .ToListAsync();

        return Ok(reads);
    }


    // Gửi tin có file đính kèm
    [HttpPost("{id:int}/attachments")]
    [RequestSizeLimit(MaxUploadBytes + 1024 * 1024)]
    public async Task<ActionResult<MessageDto>> Upload(
        int id, IFormFile file, [FromForm] string? content, [FromServices] IWebHostEnvironment env)
    {
        var me = User.GetUserId();
        if (!await IsMemberAsync(id, me)) return Forbid();

        if (file is null || file.Length == 0)
            return BadRequest(new { message = "Chưa chọn file." });
        if (file.Length > MaxUploadBytes)
            return BadRequest(new { message = "File quá lớn (tối đa 10 MB)." });

        var ext = Path.GetExtension(file.FileName).ToLowerInvariant();
        if (!AllowedTypes.TryGetValue(ext, out var contentType))
            return BadRequest(new { message = "Loại file này không được hỗ trợ." });

        content = (content ?? "").Trim();
        if (content.Length > 4000)
            return BadRequest(new { message = "Tin nhắn quá dài (tối đa 4000 ký tự)." });

        // lưu file với tên ngẫu nhiên, không dùng tên gốc
        var folder = Path.Combine(env.ContentRootPath, "uploads");
        Directory.CreateDirectory(folder);
        var stored = $"{Guid.NewGuid():N}{ext}";
        await using (var stream = System.IO.File.Create(Path.Combine(folder, stored)))
        {
            await file.CopyToAsync(stream);
        }

        var originalName = Path.GetFileName(file.FileName);
        if (originalName.Length > 200) originalName = originalName[^200..];

        var message = new Message
        {
            ConversationId = id,
            SenderId = me,
            Content = content,
            AttachmentPath = stored,
            AttachmentName = originalName,
            AttachmentContentType = contentType,
            AttachmentSize = file.Length
        };
        _db.Messages.Add(message);
        await _db.SaveChangesAsync();

        var sender = await _db.Users
           .Where(u => u.Id == me)
           .Select(u => new { Name = u.DisplayName ?? u.Username, u.AvatarUrl })
           .FirstAsync();

        var dto = new MessageDto
        {
            Id = message.Id,
            ConversationId = id,
            SenderId = me,
            SenderName = sender.Name,
            SenderAvatarUrl = sender.AvatarUrl,
            Content = message.Content,
            CreatedAt = message.CreatedAt,
            AttachmentUrl = "/uploads/" + stored,
            AttachmentName = originalName,
            AttachmentContentType = contentType,
            AttachmentSize = file.Length
        };

        var memberIds = await _db.ConversationMembers
            .Where(m => m.ConversationId == id)
            .Select(m => m.UserId)
            .ToListAsync();

        await _hub.Clients.Groups(memberIds.Select(ChatHub.UserGroup).ToList())
            .SendAsync("ReceiveMessage", dto);

        return Ok(dto);
    }
    // ---------- Nhóm ----------

    [HttpPost("group")]
    public async Task<ActionResult<ConversationDto>> CreateGroup(CreateGroupRequest req)
    {
        var me = User.GetUserId();

        var name = req.Name.Trim();
        if (name.Length == 0)
            return BadRequest(new { message = "Tên nhóm không được để trống." });

        var usernames = NormalizeUsernames(req.Usernames);
        var users = await _db.Users.Where(u => usernames.Contains(u.Username)).ToListAsync();

        var missing = usernames.Except(users.Select(u => u.Username)).ToList();
        if (missing.Count > 0)
            return NotFound(new { message = $"Không tìm thấy người dùng: {string.Join(", ", missing)}" });
        var notFriends = await NonFriendsAsync(me, users);
        if (notFriends.Count > 0)
            return Deny($"Chỉ thêm được bạn bè vào nhóm. Chưa là bạn bè: {string.Join(", ", notFriends)}");

        var memberIds = users.Select(u => u.Id).Append(me).Distinct().ToList();
        if (memberIds.Count < 3)
            return BadRequest(new { message = "Nhóm cần ít nhất 3 người (bạn và 2 người khác)." });
        if (memberIds.Count > MaxGroupMembers)
            return BadRequest(new { message = $"Nhóm tối đa {MaxGroupMembers} thành viên." });

        var conv = new Conversation { Type = ConversationType.Group, Name = name };
        foreach (var userId in memberIds)
        {
            conv.Members.Add(new ConversationMember
            {
                UserId = userId,
                Role = userId == me ? MemberRole.Admin : MemberRole.Member
            });
        }

        _db.Conversations.Add(conv);
        await _db.SaveChangesAsync();
        await NotifyAsync(memberIds);

        return Ok(new ConversationDto
        {
            Id = conv.Id,
            Type = "group",
            Name = name,
            MemberCount = memberIds.Count,
            IsAdmin = true
        });
    }

    [HttpGet("{id:int}/members")]
    public async Task<ActionResult<List<MemberDto>>> GetMembers(int id)
    {
        var me = User.GetUserId();
        if (!await IsMemberAsync(id, me)) return Forbid();

        var members = await _db.ConversationMembers
            .Where(m => m.ConversationId == id)
            .OrderByDescending(m => m.Role)
            .ThenBy(m => m.JoinedAt)
            .Select(m => new MemberDto
            {
                UserId = m.UserId,
                Username = m.User.Username,
                DisplayName = m.User.DisplayName ?? m.User.Username,
                AvatarUrl = m.User.AvatarUrl,
                IsAdmin = m.Role == MemberRole.Admin
            })
            .ToListAsync();

        return Ok(members);
    }

    [HttpPost("{id:int}/members")]
    public async Task<ActionResult> AddMembers(int id, AddMembersRequest req)
    {
        var me = User.GetUserId();
        var conv = await LoadForMemberAsync(id, me);
        if (conv is null) return Forbid();

        if (conv.Type != ConversationType.Group)
            return BadRequest(new { message = "Chỉ thêm thành viên vào nhóm." });
        if (!IsAdmin(conv, me))
            return Deny("Chỉ quản trị viên mới được thêm thành viên.");

        var usernames = NormalizeUsernames(req.Usernames);
        if (usernames.Count == 0)
            return BadRequest(new { message = "Chưa nhập tên đăng nhập nào." });

        var users = await _db.Users.Where(u => usernames.Contains(u.Username)).ToListAsync();
        var missing = usernames.Except(users.Select(u => u.Username)).ToList();
        if (missing.Count > 0)
            return NotFound(new { message = $"Không tìm thấy người dùng: {string.Join(", ", missing)}" });

        var existing = conv.Members.Select(m => m.UserId).ToHashSet();
        var toAdd = users.Where(u => !existing.Contains(u.Id)).ToList();
        if (toAdd.Count == 0)
            return BadRequest(new { message = "Những người này đã ở trong nhóm." });
        var notFriends = await NonFriendsAsync(me, toAdd);
        if (notFriends.Count > 0)
            return Deny($"Chỉ thêm được bạn bè vào nhóm. Chưa là bạn bè: {string.Join(", ", notFriends)}");
        if (existing.Count + toAdd.Count > MaxGroupMembers)
            return BadRequest(new { message = $"Nhóm tối đa {MaxGroupMembers} thành viên." });

        foreach (var user in toAdd)
            conv.Members.Add(new ConversationMember { UserId = user.Id });

        await _db.SaveChangesAsync();
        await NotifyAsync(conv.Members.Select(m => m.UserId));

        return NoContent();
    }

    [HttpDelete("{id:int}/members/{userId:int}")]
    public async Task<ActionResult> RemoveMember(int id, int userId)
    {
        var me = User.GetUserId();
        var conv = await LoadForMemberAsync(id, me);
        if (conv is null) return Forbid();

        if (conv.Type != ConversationType.Group)
            return BadRequest(new { message = "Chỉ xoá thành viên trong nhóm." });
        if (userId == me)
            return BadRequest(new { message = "Muốn rời nhóm hãy dùng chức năng Rời nhóm." });
        if (!IsAdmin(conv, me))
            return Deny("Chỉ quản trị viên mới được xoá thành viên.");

        var target = conv.Members.FirstOrDefault(m => m.UserId == userId);
        if (target is null)
            return NotFound(new { message = "Người này không ở trong nhóm." });
        if (target.Role == MemberRole.Admin)
            return Deny("Không thể xoá quản trị viên.");

        var affected = conv.Members.Select(m => m.UserId).ToList();

        _db.ConversationMembers.Remove(target);
        await _db.SaveChangesAsync();
        await NotifyAsync(affected);

        return NoContent();
    }

    [HttpPost("{id:int}/leave")]
    public async Task<ActionResult> Leave(int id)
    {
        var me = User.GetUserId();
        var conv = await LoadForMemberAsync(id, me);
        if (conv is null) return Forbid();

        if (conv.Type != ConversationType.Group)
            return BadRequest(new { message = "Chỉ rời được cuộc trò chuyện nhóm." });

        var mine = conv.Members.First(m => m.UserId == me);
        var affected = conv.Members.Select(m => m.UserId).ToList();
        var remaining = conv.Members.Where(m => m.UserId != me).ToList();

        if (remaining.Count == 0)
        {
            // không còn ai: xoá nhóm (kèm toàn bộ tin nhắn)
            _db.Conversations.Remove(conv);
        }
        else
        {
            _db.ConversationMembers.Remove(mine);

            // quản trị viên rời đi mà không còn quản trị viên nào: người vào sớm nhất lên thay
            if (mine.Role == MemberRole.Admin && remaining.All(m => m.Role != MemberRole.Admin))
                remaining.OrderBy(m => m.JoinedAt).First().Role = MemberRole.Admin;
        }

        await _db.SaveChangesAsync();
        await NotifyAsync(affected);

        return NoContent();
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult> Rename(int id, RenameRequest req)
    {
        var me = User.GetUserId();
        var conv = await LoadForMemberAsync(id, me);
        if (conv is null) return Forbid();

        if (conv.Type != ConversationType.Group)
            return BadRequest(new { message = "Chỉ đổi tên được cuộc trò chuyện nhóm." });
        if (!IsAdmin(conv, me))
            return Deny("Chỉ quản trị viên mới được đổi tên nhóm.");

        var name = req.Name.Trim();
        if (name.Length == 0)
            return BadRequest(new { message = "Tên nhóm không được để trống." });

        conv.Name = name;
        await _db.SaveChangesAsync();
        await NotifyAsync(conv.Members.Select(m => m.UserId));

        return NoContent();
    }

    // ---------- Hàm dùng chung ----------

    private static List<string> NormalizeUsernames(IEnumerable<string>? raw) =>
        (raw ?? Enumerable.Empty<string>())
            .Select(u => u.Trim().ToLowerInvariant())
            .Where(u => u.Length > 0)
            .Distinct()
            .ToList();

    private Task<bool> IsMemberAsync(int conversationId, int userId) =>
        _db.ConversationMembers.AnyAsync(m => m.ConversationId == conversationId && m.UserId == userId);

    // Trả null nếu cuộc trò chuyện không tồn tại hoặc người gọi không thuộc về nó
    private async Task<Conversation?> LoadForMemberAsync(int id, int me)
    {
        var conv = await _db.Conversations
            .Include(c => c.Members)
            .FirstOrDefaultAsync(c => c.Id == id);

        return conv is not null && conv.Members.Any(m => m.UserId == me) ? conv : null;
    }

    private static bool IsAdmin(Conversation conv, int userId) =>
        conv.Members.Any(m => m.UserId == userId && m.Role == MemberRole.Admin);

    private Task NotifyAsync(IEnumerable<int> userIds)
    {
        var groups = userIds.Distinct().Select(ChatHub.UserGroup).ToList();
        return _hub.Clients.Groups(groups).SendAsync("ConversationsChanged");
    }

    private ObjectResult Deny(string message) =>
        StatusCode(StatusCodes.Status403Forbidden, new { message });

    // Trả về username của những người KHÔNG phải bạn bè của "me"
    private async Task<List<string>> NonFriendsAsync(int me, IEnumerable<User> users)
    {
        var targets = users.Where(u => u.Id != me).ToList();
        var ids = targets.Select(u => u.Id).ToList();

        var friendIds = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Accepted
                        && ((f.RequesterId == me && ids.Contains(f.AddresseeId))
                            || (f.AddresseeId == me && ids.Contains(f.RequesterId))))
            .Select(f => f.RequesterId == me ? f.AddresseeId : f.RequesterId)
            .ToListAsync();

        return targets
            .Where(u => !friendIds.Contains(u.Id))
            .Select(u => u.Username)
            .ToList();
    }
}