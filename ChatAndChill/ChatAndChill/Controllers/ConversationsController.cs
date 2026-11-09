using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class ConversationsController : ControllerBase
{
    private readonly AppDbContext _db;

    public ConversationsController(AppDbContext db)
    {
        _db = db;
    }

    // Bắt đầu (hoặc mở lại) cuộc trò chuyện 1-1 với một username
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
            Name = other.DisplayName ?? other.Username
        });
    }

    // Danh sách cuộc trò chuyện của tôi, kèm tin nhắn cuối
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
                OtherName = c.Members
                    .Where(m => m.UserId != me)
                    .Select(m => m.User.DisplayName ?? m.User.Username)
                    .FirstOrDefault(),
                Last = c.Messages
                    .OrderByDescending(x => x.Id)
                    .Select(x => new MessageDto
                    {
                        Id = x.Id,
                        ConversationId = x.ConversationId,
                        SenderId = x.SenderId,
                        SenderName = x.Sender.DisplayName ?? x.Sender.Username,
                        Content = x.Content,
                        CreatedAt = x.CreatedAt
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
                LastMessage = r.Last
            })
            .ToList();

        return Ok(result);
    }

    // Lịch sử tin nhắn, phân trang: lấy các tin cũ hơn id "before"
    [HttpGet("{id:int}/messages")]
    public async Task<ActionResult<List<MessageDto>>> GetMessages(
        int id, [FromQuery] long? before, [FromQuery] int limit = 30)
    {
        var me = User.GetUserId();

        var isMember = await _db.ConversationMembers
            .AnyAsync(m => m.ConversationId == id && m.UserId == me);
        if (!isMember) return Forbid();

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
                Content = m.Content,
                CreatedAt = m.CreatedAt
            })
            .ToListAsync();

        items.Reverse();
        return Ok(items);
    }
}