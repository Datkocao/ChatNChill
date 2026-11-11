using ChatAndChill.Data;
using System.Collections.Concurrent;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Hubs;

[Authorize]
public class ChatHub : Hub
{
    private readonly AppDbContext _db;

    // userId -> số kết nối đang mở (nhiều tab = nhiều kết nối)
    private static readonly ConcurrentDictionary<int, int> Online = new();

    public ChatHub(AppDbContext db)
    {
        _db = db;
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

        var senderName = await _db.Users
            .Where(u => u.Id == me)
            .Select(u => u.DisplayName ?? u.Username)
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
            SenderName = senderName,
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

        var name = await _db.Users
            .Where(u => u.Id == me)
            .Select(u => u.DisplayName ?? u.Username)
            .FirstAsync();

        // Gửi cho mọi thành viên trừ chính người đang gõ
        var groups = memberIds
            .Where(id => id != me)
            .Select(UserGroup)
            .ToList();

        await Clients.Groups(groups)
            .SendAsync("UserTyping", new { conversationId, userId = me, name });
    }

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