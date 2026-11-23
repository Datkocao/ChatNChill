using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Extensions;
using ChatAndChill.Services;
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

    public RoomsController(AppDbContext db, RoomService rooms, R2StorageService r2, IConfiguration config)
    {
        _db = db;
        _rooms = rooms;
        _r2 = r2;
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

}