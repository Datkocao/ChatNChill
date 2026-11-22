using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Services;
using Livekit.Server.Sdk.Dotnet;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Controllers;

[ApiController]
[Authorize]
[Route("api/[controller]")]
public class RoomsController : ControllerBase
{
    private static readonly TimeSpan LinkLifetime = TimeSpan.FromHours(6);

    private readonly AppDbContext _db;
    private readonly RoomService _rooms;
    private readonly R2StorageService _r2;
    private readonly IConfiguration _config;

    public RoomsController(AppDbContext db, RoomService rooms, R2StorageService r2, IConfiguration config)
    {
        _db = db;
        _rooms = rooms;
        _r2 = r2;
        _config = config;
    }

    // Link phát một bài trong danh sách phát của phòng. Chỉ thành viên phòng mới lấy được.
    [HttpGet("{roomId}/tracks/{trackId:int}/url")]
    public async Task<ActionResult<TrackUrlDto>> GetTrackUrl(string roomId, int trackId)
    {
        var me = User.GetUserId();

        if (!_rooms.IsMember(roomId, me)) return Forbid();
        if (!_rooms.QueueContainsTrack(roomId, trackId))
            return NotFound(new { message = "Bài này không có trong danh sách phát của phòng." });

        var key = await _db.Tracks
            .Where(t => t.Id == trackId)
            .Select(t => t.ObjectKey)
            .FirstOrDefaultAsync();
        if (key is null)
            return NotFound(new { message = "Bài này đã bị xoá khỏi kho nhạc." });

        return Ok(new TrackUrlDto { Url = _r2.GetDownloadUrl(key, lifetime: LinkLifetime) });
    }

    // Vé vào phòng gọi của phòng nghe nhạc (cùng LiveKit với gọi trong chat)
    [HttpPost("{roomId}/token")]
    public async Task<ActionResult<CallTokenDto>> GetCallToken(string roomId)
    {
        var me = User.GetUserId();

        if (!_rooms.IsMember(roomId, me)) return Forbid();

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
            .WithGrants(new VideoGrants { RoomJoin = true, Room = $"room-{roomId}" })
            .WithTtl(TimeSpan.FromHours(2))
            .ToJwt();

        return Ok(new CallTokenDto { Token = jwt, Url = url });
    }
}