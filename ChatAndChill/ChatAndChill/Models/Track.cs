namespace ChatAndChill.Models;

public class Track
{
    public int Id { get; set; }

    public int UploaderId { get; set; }
    public User Owner { get; set; } = null!;

    public string Title { get; set; } = "";
    public string? Artist { get; set; }
    public int? DurationSeconds { get; set; }

    public string ObjectKey { get; set; } = "";   // key của file nhạc trên R2
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    // thêm vào cuối class Track, trước dấu } đóng class
    public string Origin { get; set; } = TrackOrigin.Upload;   // "Upload" hoặc "Youtube"
    public string? ContentHash { get; set; }                   // SHA-256 dạng hex (64 ký tự), null với bài cũ
    public string? SourceId { get; set; }                      // ví dụ "youtube:A_rDJ-ckxqA", null nếu upload tay
}
// thêm vào cuối file Track.cs, ngoài class Track
public static class TrackOrigin
{
    public const string Upload = "Upload";
    public const string Youtube = "Youtube";
}