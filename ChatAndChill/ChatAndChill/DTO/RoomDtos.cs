namespace ChatAndChill.Dtos;

public class RoomTrackDto
{
    public int TrackId { get; set; }
    public string Title { get; set; } = "";
    public string? Artist { get; set; }
    public int? DurationSeconds { get; set; }
    public int AddedById { get; set; }
}

public class RoomMemberDto
{
    public int UserId { get; set; }
    public string Name { get; set; } = "";
    public string? AvatarUrl { get; set; }
}

// Ảnh chụp trạng thái phòng: server gửi cho mọi thành viên mỗi khi có thay đổi
public class RoomStateDto
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public int HostId { get; set; }
    public List<RoomMemberDto> Members { get; set; } = new();
    public List<RoomTrackDto> Queue { get; set; } = new();
    public int CurrentIndex { get; set; } = -1;       // -1 = chưa có bài nào
    public bool IsPlaying { get; set; }
    public double PositionSeconds { get; set; }       // vị trí phát tại thời điểm ServerTimeMs
    public long ServerTimeMs { get; set; }            // Unix ms của server lúc chụp
    public long Version { get; set; }                 // tăng mỗi lần đổi, client bỏ qua bản cũ hơn
}

public class RoomInviteDto
{
    public string RoomId { get; set; } = "";
    public string RoomName { get; set; } = "";
    public int InviterId { get; set; }
    public string InviterName { get; set; } = "";
}