using ChatAndChill.Data;
using System.Collections.Concurrent;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Reflection;
using ChatAndChill.Services;

namespace ChatAndChill.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly AppDbContext _db;
    private readonly RoomService _rooms;

    // userId -> số kết nối đang mở (nhiều tab = nhiều kết nối)
    private static readonly ConcurrentDictionary<int, int> Online = new();

    public ChatHub(AppDbContext db, RoomService rooms)
    {
        _db = db;
        _rooms = rooms;
    }

    public static string UserGroup(int userId) => $"user-{userId}";

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User!.GetUserId();
        await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(userId));

        var count = Online.AddOrUpdate(userId, 1, (_, c) => c + 1);
        if (count == 1)
            await NotifyPresenceAsync(userId, "UserOnline");

        await base.OnConnectedAsync();
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var userId = Context.User!.GetUserId();

        var count = Online.AddOrUpdate(userId, 0, (_, c) => c - 1);
        if (count <= 0)
        {
            Online.TryRemove(new KeyValuePair<int, int>(userId, count));
            await NotifyPresenceAsync(userId, "UserOffline");
            await LeaveAllRoomsAsync(userId);
        }

        await base.OnDisconnectedAsync(exception);
    }

    // Client gọi khi vừa vào trang: trả về những người liên quan đang online
    public async Task<List<int>> GetOnlineUserIds()
    {
        var me = Context.User!.GetUserId();
        var contacts = await GetContactIdsAsync(me);
        return contacts.Where(Online.ContainsKey).ToList();
    }

    // Bạn bè + những người chung cuộc trò chuyện
    private async Task<List<int>> GetContactIdsAsync(int me)
    {
        var fromChats = await _db.ConversationMembers
            .Where(m => m.UserId != me
                && _db.ConversationMembers.Any(x => x.ConversationId == m.ConversationId && x.UserId == me))
            .Select(m => m.UserId)
            .Distinct()
            .ToListAsync();

        var fromFriends = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Accepted
                        && (f.RequesterId == me || f.AddresseeId == me))
            .Select(f => f.RequesterId == me ? f.AddresseeId : f.RequesterId)
            .ToListAsync();

        return fromChats.Union(fromFriends).ToList();
    }

    private async Task NotifyPresenceAsync(int userId, string eventName)
    {
        var contacts = await GetContactIdsAsync(userId);
        if (contacts.Count == 0) return;

        var groups = contacts.Select(UserGroup).ToList();
        await Clients.Groups(groups).SendAsync(eventName, userId);
    }

    public async Task SendMessage(int conversationId, string content)
    {
        var me = Context.User!.GetUserId();

        content = (content ?? "").Trim();
        if (content.Length == 0)
            throw new HubException("Tin nhắn trống.");
        if (content.Length > 4000)
            throw new HubException("Tin nhắn quá dài (tối đa 4000 ký tự).");

        var memberIds = await _db.ConversationMembers
            .Where(m => m.ConversationId == conversationId)
            .Select(m => m.UserId)
            .ToListAsync();

        if (!memberIds.Contains(me))
            throw new HubException("Bạn không thuộc cuộc trò chuyện này.");

        var sender = await _db.Users
            .Where(u => u.Id == me)
            .Select(u => new { Name = u.DisplayName ?? u.Username, u.AvatarUrl })
            .FirstAsync();

        var message = new Message
        {
            ConversationId = conversationId,
            SenderId = me,
            Content = content
        };
        _db.Messages.Add(message);
        await _db.SaveChangesAsync();

        var dto = new MessageDto
        {
            Id = message.Id,
            ConversationId = conversationId,
            SenderId = me,
            SenderName = sender.Name,
            SenderAvatarUrl = sender.AvatarUrl,
            Content = message.Content,
            CreatedAt = message.CreatedAt
        };

        var groups = memberIds.Select(UserGroup).ToList();
        await Clients.Groups(groups).SendAsync("ReceiveMessage", dto);
    }
    public async Task Typing(int conversationId)
    {
        var me = Context.User!.GetUserId();

        var memberIds = await _db.ConversationMembers
            .Where(m => m.ConversationId == conversationId)
            .Select(m => m.UserId)
            .ToListAsync();

        // Không phải thành viên thì bỏ qua, không cần báo lỗi cho tín hiệu "đang gõ"
        if (!memberIds.Contains(me))
            return;

        var sender = await _db.Users
      .Where(u => u.Id == me)
      .Select(u => new { Name = u.DisplayName ?? u.Username, u.AvatarUrl })
      .FirstAsync();

        // Gửi cho mọi thành viên trừ chính người đang gõ
        var groups = memberIds
            .Where(id => id != me)
            .Select(UserGroup)
            .ToList();

        await Clients.Groups(groups)
            .SendAsync("UserTyping", new { conversationId, userId = me, name = sender.Name });
    }

    // Báo cho các thành viên khác biết mình vừa mở cuộc gọi trong cuộc trò chuyện này
    public async Task NotifyCall(int conversationId)
    {
        var me = Context.User!.GetUserId();

        var memberIds = await _db.ConversationMembers
            .Where(m => m.ConversationId == conversationId)
            .Select(m => m.UserId)
            .ToListAsync();

        if (!memberIds.Contains(me))
            throw new HubException("Bạn không thuộc cuộc trò chuyện này.");

        var callerName = await _db.Users
            .Where(u => u.Id == me)
            .Select(u => u.DisplayName ?? u.Username)
            .FirstAsync();

        var groups = memberIds.Where(id => id != me).Select(UserGroup).ToList();
        if (groups.Count == 0) return;

        await Clients.Groups(groups).SendAsync("IncomingCall", new
        {
            conversationId,
            callerId = me,
            callerName
        });
    }
    // ================= PHÒNG NGHE NHẠC =================
    // Sự kiện server -> client: RoomState (RoomStateDto), RoomInvite (RoomInviteDto), RoomLeft (roomId)

    private async Task<RoomMember> GetRoomMemberAsync(int userId)
    {
        var info = await _db.Users
            .Where(x => x.Id == userId)
            .Select(x => new { Name = x.DisplayName ?? x.Username, x.AvatarUrl })
            .FirstAsync();
        return new RoomMember(userId, info.Name, info.AvatarUrl);
    }

    private Task BroadcastRoomAsync(RoomStateDto state)
    {
        var groups = state.Members.Select(m => UserGroup(m.UserId)).ToList();
        return Clients.Groups(groups).SendAsync("RoomState", state);
    }

    // Chạy một thao tác của RoomService, đổi RoomException thành HubException, rồi phát trạng thái mới
    private async Task ApplyRoomAsync(Func<RoomStateDto?> action)
    {
        RoomStateDto? state;
        try { state = action(); }
        catch (RoomException ex) { throw new HubException(ex.Message); }

        if (state is not null) await BroadcastRoomAsync(state);
    }

    private async Task LeaveRoomInternalAsync(string roomId, int userId)
    {
        var state = _rooms.Leave(roomId, userId);
        await Clients.Group(UserGroup(userId)).SendAsync("RoomLeft", roomId);
        if (state is not null) await BroadcastRoomAsync(state);
    }

    // Mỗi người chỉ ở một phòng một lúc
    private async Task LeaveAllRoomsAsync(int userId, string? except = null)
    {
        foreach (var id in _rooms.RoomIdsOf(userId).Where(id => id != except))
            await LeaveRoomInternalAsync(id, userId);
    }

    public async Task<RoomStateDto> CreateRoom(string? name)
    {
        var me = Context.User!.GetUserId();
        await LeaveAllRoomsAsync(me);

        var state = _rooms.Create(await GetRoomMemberAsync(me), name ?? "");
        await BroadcastRoomAsync(state);
        return state;
    }

    // Mời bạn bè vào phòng (chỉ mời được người đã là bạn)
    public async Task InviteToRoom(string roomId, List<int> friendIds)
    {
        var me = Context.User!.GetUserId();
        if (friendIds is null || friendIds.Count == 0) return;

        var ids = friendIds.Distinct().Take(20).ToList();
        var validIds = await _db.Friendships
            .Where(f => f.Status == FriendshipStatus.Accepted
                        && ((f.RequesterId == me && ids.Contains(f.AddresseeId))
                            || (f.AddresseeId == me && ids.Contains(f.RequesterId))))
            .Select(f => f.RequesterId == me ? f.AddresseeId : f.RequesterId)
            .ToListAsync();

        List<int> added;
        string roomName;
        try { added = _rooms.Invite(roomId, me, validIds, out roomName); }
        catch (RoomException ex) { throw new HubException(ex.Message); }
        if (added.Count == 0) return;

        var inviterName = await _db.Users
            .Where(x => x.Id == me)
            .Select(x => x.DisplayName ?? x.Username)
            .FirstAsync();

        var groups = added.Select(UserGroup).ToList();
        await Clients.Groups(groups).SendAsync("RoomInvite", new RoomInviteDto
        {
            RoomId = roomId,
            RoomName = roomName,
            InviterId = me,
            InviterName = inviterName
        });
    }

    public async Task<RoomStateDto> JoinRoom(string roomId)
    {
        var me = Context.User!.GetUserId();
        await LeaveAllRoomsAsync(me, except: roomId);

        RoomStateDto state;
        try { state = _rooms.Join(roomId, await GetRoomMemberAsync(me)); }
        catch (RoomException ex) { throw new HubException(ex.Message); }

        await BroadcastRoomAsync(state);
        return state;
    }

    public Task LeaveRoom(string roomId)
        => LeaveRoomInternalAsync(roomId, Context.User!.GetUserId());

    // Lấy lại trạng thái phòng (dùng khi mới tải lại trang hoặc nối lại SignalR)
    public RoomStateDto? GetRoomState(string roomId)
    {
        var me = Context.User!.GetUserId();
        return _rooms.IsMember(roomId, me) ? _rooms.GetState(roomId) : null;
    }

    // Mọi thành viên đều thêm được bài từ kho chung
    public async Task RoomAddTrack(string roomId, int trackId)
    {
        var me = Context.User!.GetUserId();

        var t = await _db.Tracks
            .Where(x => x.Id == trackId)
            .Select(x => new { x.Title, x.Artist, x.DurationSeconds })
            .FirstOrDefaultAsync();
        if (t is null) throw new HubException("Không tìm thấy bài hát.");

        await ApplyRoomAsync(() => _rooms.AddTrack(
            roomId, me, new RoomTrack(trackId, t.Title, t.Artist, t.DurationSeconds, me)));
    }

    public Task RoomRemoveTrack(string roomId, int index)
        => ApplyRoomAsync(() => _rooms.RemoveTrack(roomId, Context.User!.GetUserId(), index));

    // Các thao tác dưới đây chỉ chủ phòng làm được (RoomService kiểm tra)
    public Task RoomMoveTrack(string roomId, int from, int to)
        => ApplyRoomAsync(() => _rooms.MoveTrack(roomId, Context.User!.GetUserId(), from, to));

    public Task RoomPlay(string roomId, int? index)
        => ApplyRoomAsync(() => _rooms.Play(roomId, Context.User!.GetUserId(), index));

    public Task RoomPause(string roomId)
        => ApplyRoomAsync(() => _rooms.Pause(roomId, Context.User!.GetUserId()));

    public Task RoomSeek(string roomId, double seconds)
        => ApplyRoomAsync(() => _rooms.Seek(roomId, Context.User!.GetUserId(), seconds));

    public Task RoomNext(string roomId)
        => ApplyRoomAsync(() => _rooms.Next(roomId, Context.User!.GetUserId()));

    public Task RoomPrev(string roomId)
        => ApplyRoomAsync(() => _rooms.Prev(roomId, Context.User!.GetUserId()));

    // Mọi client báo "bài index đã hết"; chỉ lần báo đầu tiên có tác dụng
    public Task RoomTrackEnded(string roomId, int index)
        => ApplyRoomAsync(() => _rooms.TrackEnded(roomId, Context.User!.GetUserId(), index));

    // Client gọi khi đã xem tới tin messageId trong cuộc trò chuyện
    public async Task MarkRead(int conversationId, long messageId)
    {
        var me = Context.User!.GetUserId();

        var members = await _db.ConversationMembers
            .Where(m => m.ConversationId == conversationId)
            .ToListAsync();

        var mine = members.FirstOrDefault(m => m.UserId == me);
        if (mine is null)
            return;

        // tin phải thật sự thuộc cuộc trò chuyện này
        var valid = await _db.Messages
            .AnyAsync(m => m.Id == messageId && m.ConversationId == conversationId);
        if (!valid)
            return;

        // chỉ tiến lên, không lùi, và không làm gì nếu không có gì mới
        if (mine.LastReadMessageId is not null && mine.LastReadMessageId >= messageId)
            return;

        mine.LastReadMessageId = messageId;
        await _db.SaveChangesAsync();

        var groups = members
            .Where(m => m.UserId != me)
            .Select(m => UserGroup(m.UserId))
            .ToList();

        await Clients.Groups(groups)
            .SendAsync("MessagesRead", new { conversationId, userId = me, messageId });
    }
}