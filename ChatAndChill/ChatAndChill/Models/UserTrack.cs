namespace ChatAndChill.Models;

// Bài nằm trong danh sách phát của một người
public class UserTrack
{
    public int UserId { get; set; }
    public int TrackId { get; set; }
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
}