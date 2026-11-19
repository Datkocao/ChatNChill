namespace ChatAndChill.Models;

public class Track
{
    public int Id { get; set; }

    public int OwnerId { get; set; }
    public User Owner { get; set; } = null!;

    public string Title { get; set; } = "";
    public string? Artist { get; set; }
    public int? DurationSeconds { get; set; }

    public string ObjectKey { get; set; } = "";   // key của file nhạc trên R2
    public string ContentType { get; set; } = "";
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}