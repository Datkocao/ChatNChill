using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class CallsController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly IConfiguration _config;

    public CallsController(AppDbContext db, IConfiguration config)
    {
        _db = db;
        _config = config;
    }

    // Cấp vé vào phòng gọi của một cuộc trò chuyện. Chỉ thành viên mới được cấp.
    [HttpPost("{conversationId:int}/token")]
    public async Task<ActionResult<CallTokenDto>> GetToken(int conversationId)
    {
        var me = User.GetUserId();

        var isMember = await _db.ConversationMembers
            .AnyAsync(m => m.ConversationId == conversationId && m.UserId == me);
        if (!isMember) return Forbid();

        var apiKey = _config["LiveKit:ApiKey"];
        var apiSecret = _config["LiveKit:ApiSecret"];
        var url = _config["LiveKit:Url"];
        if (string.IsNullOrWhiteSpace(apiKey) || string.IsNullOrWhiteSpace(apiSecret) || string.IsNullOrWhiteSpace(url))
            return StatusCode(500, new { message = "Chưa cấu hình LiveKit trên máy chủ." });

        var user = await _db.Users
            .Where(u => u.Id == me)
            .Select(u => new { u.Username, u.DisplayName })
            .FirstAsync();

        var jwt = new AccessToken(apiKey, apiSecret)
            .WithIdentity(me.ToString())
            .WithName(user.DisplayName ?? user.Username)
            .WithGrants(new VideoGrants { RoomJoin = true, Room = $"conv-{conversationId}" })
            .WithTtl(TimeSpan.FromHours(2))
            .ToJwt();

        return Ok(new CallTokenDto { Token = jwt, Url = url });
    }
}