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
public class FriendsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IHubContext<ChatHub> _hub;

    public FriendsController(AppDbContext db, IHubContext<ChatHub> hub)
    {
        _db = db;
        _hub = hub;
    }

    // Danh sách bạn bè
    [HttpGet]
    public async Task<ActionResult<List<FriendDto>>> GetFriends()
    {
        var me = User.GetUserId();

        var rows = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Accepted
                        && (f.RequesterId == me || f.AddresseeId == me))
            .Select(f => new FriendDto
            {
                UserId = f.RequesterId == me ? f.AddresseeId : f.RequesterId,
                Username = f.RequesterId == me ? f.Addressee.Username : f.Requester.Username,
                DisplayName = f.RequesterId == me
                    ? (f.Addressee.DisplayName ?? f.Addressee.Username)
                    : (f.Requester.DisplayName ?? f.Requester.Username)
            })
            .ToListAsync();

        return Ok(rows.OrderBy(x => x.DisplayName).ToList());
    }

    // Lời mời đang chờ (đến và đi)
    [HttpGet("requests")]
    public async Task<ActionResult<List<FriendRequestDto>>> GetRequests()
    {
        var me = User.GetUserId();

        var rows = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Pending
                        && (f.RequesterId == me || f.AddresseeId == me))
            .OrderByDescending(f => f.CreatedAt)
            .Select(f => new FriendRequestDto
            {
                Id = f.Id,
                Direction = f.AddresseeId == me ? "incoming" : "outgoing",
                UserId = f.AddresseeId == me ? f.RequesterId : f.AddresseeId,
                Username = f.AddresseeId == me ? f.Requester.Username : f.Addressee.Username,
                DisplayName = f.AddresseeId == me
                    ? (f.Requester.DisplayName ?? f.Requester.Username)
                    : (f.Addressee.DisplayName ?? f.Addressee.Username),
                CreatedAt = f.CreatedAt
            })
            .ToListAsync();

        return Ok(rows);
    }

    // Tìm người theo tên đăng nhập
    [HttpGet("search")]
    public async Task<ActionResult<List<UserSearchDto>>> Search([FromQuery] string? q = null)
    {
        var me = User.GetUserId();

        q = (q ?? "").Trim().ToLowerInvariant();
        if (q.Length < 2)
            return Ok(new List<UserSearchDto>());

        var users = await _db.Users
            .Where(u => u.Id != me && u.Username.Contains(q))
            .OrderBy(u => u.Username)
            .Take(10)
            .Select(u => new { u.Id, u.Username, DisplayName = u.DisplayName ?? u.Username })
            .ToListAsync();

        var ids = users.Select(u => u.Id).ToList();

        var relations = await _db.Friendships
            .Where(f => (f.RequesterId == me && ids.Contains(f.AddresseeId))
                        || (f.AddresseeId == me && ids.Contains(f.RequesterId)))
            .ToListAsync();

        var result = users.Select(u =>
        {
            var f = relations.FirstOrDefault(x => x.RequesterId == u.Id || x.AddresseeId == u.Id);

            var relation = f is null ? "none"
                : f.Status == FriendshipStatus.Accepted ? "friend"
                : f.RequesterId == me ? "outgoing"
                : "incoming";

            return new UserSearchDto
            {
                UserId = u.Id,
                Username = u.Username,
                DisplayName = u.DisplayName,
                Relation = relation
            };
        }).ToList();

        return Ok(result);
    }

    // Gửi lời mời (nếu người kia đã mời mình từ trước thì tự chấp nhận)
    [HttpPost("requests")]
    public async Task<ActionResult> SendRequest(SendFriendRequestRequest req)
    {
        var me = User.GetUserId();
        var username = req.Username.Trim().ToLowerInvariant();

        var other = await _db.Users.FirstOrDefaultAsync(u => u.Username == username);
        if (other is null)
            return NotFound(new { message = "Không tìm thấy người dùng." });
        if (other.Id == me)
            return BadRequest(new { message = "Không thể kết bạn với chính mình." });

        var existing = await _db.Friendships.FirstOrDefaultAsync(f =>
            (f.RequesterId == me && f.AddresseeId == other.Id) ||
            (f.RequesterId == other.Id && f.AddresseeId == me));

        if (existing is not null)
        {
            if (existing.Status == FriendshipStatus.Accepted)
                return Conflict(new { message = "Hai bạn đã là bạn bè." });

            if (existing.RequesterId == me)
                return Conflict(new { message = "Bạn đã gửi lời mời rồi, hãy chờ phản hồi." });

            existing.Status = FriendshipStatus.Accepted;
            await _db.SaveChangesAsync();
            await NotifyAsync(me, other.Id);
            return NoContent();
        }

        _db.Friendships.Add(new Friendship { RequesterId = me, AddresseeId = other.Id });
        await _db.SaveChangesAsync();
        await NotifyAsync(me, other.Id);

        return NoContent();
    }

    // Chấp nhận lời mời (chỉ người nhận)
    [HttpPost("requests/{id:int}/accept")]
    public async Task<ActionResult> Accept(int id)
    {
        var me = User.GetUserId();
        var f = await _db.Friendships.FirstOrDefaultAsync(x => x.Id == id);

        if (f is null || f.AddresseeId != me || f.Status != FriendshipStatus.Pending)
            return NotFound(new { message = "Không tìm thấy lời mời." });

        f.Status = FriendshipStatus.Accepted;
        await _db.SaveChangesAsync();
        await NotifyAsync(f.RequesterId, f.AddresseeId);

        return NoContent();
    }

    // Từ chối (người nhận) hoặc huỷ lời mời (người gửi)
    [HttpDelete("requests/{id:int}")]
    public async Task<ActionResult> DeleteRequest(int id)
    {
        var me = User.GetUserId();
        var f = await _db.Friendships.FirstOrDefaultAsync(x => x.Id == id);

        if (f is null || f.Status != FriendshipStatus.Pending
            || (f.RequesterId != me && f.AddresseeId != me))
            return NotFound(new { message = "Không tìm thấy lời mời." });

        _db.Friendships.Remove(f);
        await _db.SaveChangesAsync();
        await NotifyAsync(f.RequesterId, f.AddresseeId);

        return NoContent();
    }

    // Huỷ kết bạn
    [HttpDelete("{userId:int}")]
    public async Task<ActionResult> Unfriend(int userId)
    {
        var me = User.GetUserId();

        var f = await _db.Friendships.FirstOrDefaultAsync(x =>
            x.Status == FriendshipStatus.Accepted &&
            ((x.RequesterId == me && x.AddresseeId == userId) ||
             (x.RequesterId == userId && x.AddresseeId == me)));

        if (f is null)
            return NotFound(new { message = "Hai bạn chưa là bạn bè." });

        _db.Friendships.Remove(f);
        await _db.SaveChangesAsync();
        await NotifyAsync(me, userId);

        return NoContent();
    }

    private Task NotifyAsync(params int[] userIds)
    {
        var groups = userIds.Distinct().Select(ChatHub.UserGroup).ToList();
        return _hub.Clients.Groups(groups).SendAsync("FriendsChanged");
    }
}