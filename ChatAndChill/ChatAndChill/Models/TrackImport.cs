namespace ChatAndChill.Models;

public enum ImportStatus { Queued = 0, Processing = 1, Failed = 2 }

// Một lần nhập nhạc từ link. Nhập xong thì dòng này bị xoá và bài xuất hiện trong bảng Tracks.
public class TrackImport
{
    public int Id { get; set; }

    public int OwnerId { get; set; }
    public User Owner { get; set; } = null!;

    public string Url { get; set; } = "";
    public string? Title { get; set; }          // có sau khi đọc được thông tin bài
    public ImportStatus Status { get; set; } = ImportStatus.Queued;
    public string? Error { get; set; }          // thông báo cho người dùng khi Failed
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}