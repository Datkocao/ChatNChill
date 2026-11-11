using ChatAndChill.Data;
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

    public ChatHub(AppDbContext db)
    {
        _db = db;
    }

    public static string UserGroup(int userId) => $"user-{userId}";

    public override async Task OnConnectedAsync()
    {
        var userId = Context.User!.GetUserId();
        await Groups.AddToGroupAsync(Context.ConnectionId, UserGroup(userId));
        await base.OnConnectedAsync();
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
}