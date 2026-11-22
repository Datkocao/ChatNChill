using System.Collections.Concurrent;
using ChatAndChill.Dtos;

namespace ChatAndChill.Services;

public class RoomException : Exception
{
    public RoomException(string message) : base(message) { }
}

public record RoomMember(int UserId, string Name, string? AvatarUrl);
public record RoomTrack(int TrackId, string Title, string? Artist, int? DurationSeconds, int AddedById);

// Quản lý các phòng nghe nhạc trong bộ nhớ (mất khi tắt server).
// Nếu sau này chạy nhiều server thì phải chuyển sang Redis.
public class RoomService
{
    public const int MaxMembers = 10;
    public const int MaxQueue = 100;
    public const int MaxNameLength = 50;

    private class Room
    {
        public string Id = "";
        public string Name = "";
        public int HostId;
        public readonly object Lock = new();
        public readonly List<RoomMember> Members = new();   // thứ tự = thứ tự vào phòng
        public readonly HashSet<int> Invited = new();
        public readonly List<RoomTrack> Queue = new();
        public int CurrentIndex = -1;
        public bool IsPlaying;
        public double BasePosition;        // vị trí phát tại BaseTime
        public DateTime BaseTime = DateTime.UtcNow;
        public long Version;
    }

    private readonly ConcurrentDictionary<string, Room> _rooms = new();

    // ---------- Truy vấn ----------

    public bool IsMember(string roomId, int userId)
    {
        if (!_rooms.TryGetValue(roomId, out var room)) return false;
        lock (room.Lock) return room.Members.Any(m => m.UserId == userId);
    }

    public bool Exists(string roomId) => _rooms.ContainsKey(roomId);

    public RoomStateDto? GetState(string roomId)
    {
        if (!_rooms.TryGetValue(roomId, out var room)) return null;
        lock (room.Lock) return Snapshot(room);
    }

    // Id bài đang phát (để cấp link phát đúng bài), null nếu không có
    public int? CurrentTrackId(string roomId)
    {
        if (!_rooms.TryGetValue(roomId, out var room)) return null;
        lock (room.Lock)
            return room.CurrentIndex >= 0 ? room.Queue[room.CurrentIndex].TrackId : null;
    }

    public bool QueueContainsTrack(string roomId, int trackId)
    {
        if (!_rooms.TryGetValue(roomId, out var room)) return false;
        lock (room.Lock) return room.Queue.Any(t => t.TrackId == trackId);
    }

    // Các phòng mà người này đang ở
    public List<string> RoomIdsOf(int userId) =>
        _rooms.Values
            .Where(r => { lock (r.Lock) return r.Members.Any(m => m.UserId == userId); })
            .Select(r => r.Id)
            .ToList();

    // ---------- Phòng và thành viên ----------

    public RoomStateDto Create(RoomMember host, string name)
    {
        name = (name ?? "").Trim();
        if (name.Length == 0) name = $"Phòng của {host.Name}";
        if (name.Length > MaxNameLength) name = name[..MaxNameLength];

        var room = new Room
        {
            Id = Guid.NewGuid().ToString("N")[..8],
            Name = name,
            HostId = host.UserId
        };
        room.Members.Add(host);
        room.Version = 1;
        _rooms[room.Id] = room;

        lock (room.Lock) return Snapshot(room);
    }

    // Thành viên mời thêm người. Trả về danh sách id thật sự mới được mời (để gửi thông báo).
    public List<int> Invite(string roomId, int byUserId, IEnumerable<int> userIds, out string roomName)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireMember(room, byUserId);
            roomName = room.Name;

            var added = new List<int>();
            foreach (var id in userIds.Distinct())
            {
                if (room.Members.Any(m => m.UserId == id)) continue;
                room.Invited.Add(id);
                added.Add(id);   // mời lại vẫn gửi thông báo
            }
            return added;
        }
    }

    // Vào phòng: phải được mời. Đã ở trong phòng thì chỉ trả trạng thái hiện tại.
    public RoomStateDto Join(string roomId, RoomMember member)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            if (room.Members.Any(m => m.UserId == member.UserId))
                return Snapshot(room);

            if (!room.Invited.Contains(member.UserId))
                throw new RoomException("Bạn chưa được mời vào phòng này.");
            if (room.Members.Count >= MaxMembers)
                throw new RoomException($"Phòng đã đủ {MaxMembers} người.");

            room.Invited.Remove(member.UserId);
            room.Members.Add(member);
            room.Version++;
            return Snapshot(room);
        }
    }

    // Rời phòng. Trả về trạng thái mới, hoặc null nếu phòng đã bị xoá (không còn ai).
    // Chủ phòng rời thì người vào sớm nhất lên thay.
    public RoomStateDto? Leave(string roomId, int userId)
    {
        if (!_rooms.TryGetValue(roomId, out var room)) return null;
        lock (room.Lock)
        {
            var idx = room.Members.FindIndex(m => m.UserId == userId);
            if (idx < 0) return Snapshot(room);

            room.Members.RemoveAt(idx);
            room.Members.RemoveAt(idx);
            room.Invited.Add(userId);   // cho phép vào lại (F5 trang hoặc mất mạng thoáng qua)
            if (room.Members.Count == 0)
            {
                _rooms.TryRemove(roomId, out _);
                return null;
            }

            if (room.HostId == userId)
                room.HostId = room.Members[0].UserId;

            room.Version++;
            return Snapshot(room);
        }
    }

    // ---------- Danh sách phát ----------

    public RoomStateDto AddTrack(string roomId, int userId, RoomTrack track)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireMember(room, userId);
            if (room.Queue.Count >= MaxQueue)
                throw new RoomException($"Danh sách phát tối đa {MaxQueue} bài.");

            room.Queue.Add(track);
            if (room.CurrentIndex < 0)   // bài đầu tiên: chọn sẵn nhưng chưa tự phát
            {
                room.CurrentIndex = 0;
                SetPosition(room, 0, false);
            }
            room.Version++;
            return Snapshot(room);
        }
    }

    public RoomStateDto RemoveTrack(string roomId, int userId, int index)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireHost(room, userId);
            if (index < 0 || index >= room.Queue.Count)
                throw new RoomException("Không có bài này trong danh sách.");
            if (room.HostId != userId && room.Queue[index].AddedById != userId)
                throw new RoomException("Bạn chỉ xoá được bài do mình thêm.");

            room.Queue.RemoveAt(index);

            if (room.Queue.Count == 0)
            {
                room.CurrentIndex = -1;
                SetPosition(room, 0, false);
            }
            else if (index < room.CurrentIndex)
            {
                room.CurrentIndex--;   // bài đang phát vẫn là bài đó, chỉ lệch chỉ số
            }
            else if (index == room.CurrentIndex)
            {
                // bỏ đúng bài đang phát: bài kế tiếp (hoặc bài đầu nếu đang ở cuối) lên, giữ trạng thái phát/dừng
                if (room.CurrentIndex >= room.Queue.Count) room.CurrentIndex = 0;
                SetPosition(room, 0, room.IsPlaying);
            }

            room.Version++;
            return Snapshot(room);
        }
    }

    // ---------- Điều khiển phát (mọi thành viên đều làm được) ----------

    // index = null: tiếp tục bài hiện tại; có index: nhảy tới bài đó và phát từ đầu
    public RoomStateDto Play(string roomId, int userId, int? index)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireHost(room, userId);
            if (room.Queue.Count == 0)
                throw new RoomException("Danh sách phát đang trống.");

            if (index is int i)
            {
                if (i < 0 || i >= room.Queue.Count)
                    throw new RoomException("Không có bài này trong danh sách.");
                room.CurrentIndex = i;
                SetPosition(room, 0, true);
            }
            else if (!room.IsPlaying)
            {
                SetPosition(room, room.BasePosition, true);
            }

            room.Version++;
            return Snapshot(room);
        }
    }

    public RoomStateDto Pause(string roomId, int userId)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireHost(room, userId);
            if (room.IsPlaying)
                SetPosition(room, CurrentPosition(room), false);
            room.Version++;
            return Snapshot(room);
        }
    }

    public RoomStateDto Seek(string roomId, int userId, double seconds)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireHost(room, userId);
            if (room.CurrentIndex < 0)
                throw new RoomException("Chưa có bài nào để tua.");

            if (double.IsNaN(seconds) || double.IsInfinity(seconds) || seconds < 0) seconds = 0;
            SetPosition(room, seconds, room.IsPlaying);
            room.Version++;
            return Snapshot(room);
        }
    }

    public RoomStateDto Next(string roomId, int userId)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireHost(room, userId);
            if (room.Queue.Count == 0)
                throw new RoomException("Danh sách phát đang trống.");

            room.CurrentIndex = (room.CurrentIndex + 1) % room.Queue.Count;   // ở cuối thì quay về đầu
            SetPosition(room, 0, true);
            room.Version++;
            return Snapshot(room);
        }
    }

    public RoomStateDto Prev(string roomId, int userId)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireHost(room, userId);
            if (room.Queue.Count == 0)
                throw new RoomException("Danh sách phát đang trống.");

            if (CurrentPosition(room) > 3)
            {
                SetPosition(room, 0, room.IsPlaying);   // đã phát quá 3 giây thì chỉ tua về đầu bài
            }
            else
            {
                room.CurrentIndex = (room.CurrentIndex - 1 + room.Queue.Count) % room.Queue.Count;
                SetPosition(room, 0, true);
            }
            room.Version++;
            return Snapshot(room);
        }
    }

    // Mỗi client báo "bài này hết rồi". Chỉ lần báo đầu tiên (đúng bài đang phát) có tác dụng,
    // các lần sau trả null để hub không phát lại sự kiện.
    public RoomStateDto? TrackEnded(string roomId, int userId, int index)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireMember(room, userId);
            if (room.CurrentIndex != index || !room.IsPlaying) return null;

            room.CurrentIndex = (room.CurrentIndex + 1) % room.Queue.Count;
            SetPosition(room, 0, true);
            room.Version++;
            return Snapshot(room);
        }
    }
    // Chủ phòng đổi chỗ một bài trong danh sách (đưa lên trước hoặc ra sau)
    public RoomStateDto MoveTrack(string roomId, int userId, int from, int to)
    {
        var room = GetRoom(roomId);
        lock (room.Lock)
        {
            RequireHost(room, userId);
            var n = room.Queue.Count;
            if (from < 0 || from >= n || to < 0 || to >= n)
                throw new RoomException("Vị trí không hợp lệ.");
            if (from == to) return Snapshot(room);

            var item = room.Queue[from];
            room.Queue.RemoveAt(from);
            room.Queue.Insert(to, item);

            // giữ cho bài đang phát vẫn là bài đó, không đổi vị trí phát
            if (room.CurrentIndex == from) room.CurrentIndex = to;
            else if (from < room.CurrentIndex && to >= room.CurrentIndex) room.CurrentIndex--;
            else if (from > room.CurrentIndex && to <= room.CurrentIndex) room.CurrentIndex++;

            room.Version++;
            return Snapshot(room);
        }
    }

    // ---------- Hàm nội bộ ----------

    private Room GetRoom(string roomId)
    {
        if (!_rooms.TryGetValue(roomId, out var room))
            throw new RoomException("Phòng không tồn tại hoặc đã đóng.");
        return room;
    }

    private static void RequireMember(Room room, int userId)
    {
        if (!room.Members.Any(m => m.UserId == userId))
            throw new RoomException("Bạn không ở trong phòng này.");
    }
    private static void RequireHost(Room room, int userId)
    {
        if (room.HostId != userId)
            throw new RoomException("Chỉ chủ phòng mới điều khiển được nhạc.");
    }
    private static void SetPosition(Room room, double seconds, bool playing)
    {
        room.BasePosition = seconds;
        room.BaseTime = DateTime.UtcNow;
        room.IsPlaying = playing;
    }

    private static double CurrentPosition(Room room)
    {
        var pos = room.IsPlaying
            ? room.BasePosition + (DateTime.UtcNow - room.BaseTime).TotalSeconds
            : room.BasePosition;

        if (room.CurrentIndex >= 0 && room.Queue[room.CurrentIndex].DurationSeconds is int d && pos > d)
            pos = d;
        return pos;
    }

    private static RoomStateDto Snapshot(Room room) => new()
    {
        Id = room.Id,
        Name = room.Name,
        HostId = room.HostId,
        Members = room.Members
            .Select(m => new RoomMemberDto { UserId = m.UserId, Name = m.Name, AvatarUrl = m.AvatarUrl })
            .ToList(),
        Queue = room.Queue
            .Select(t => new RoomTrackDto
            {
                TrackId = t.TrackId,
                Title = t.Title,
                Artist = t.Artist,
                DurationSeconds = t.DurationSeconds,
                AddedById = t.AddedById
            })
            .ToList(),
        CurrentIndex = room.CurrentIndex,
        IsPlaying = room.IsPlaying,
        PositionSeconds = CurrentPosition(room),
        ServerTimeMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
        Version = room.Version
    };
}