namespace ChatAndChill.Dtos;

public class TrackDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Artist { get; set; }
    public int? DurationSeconds { get; set; }
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; }
}

public class TrackListDto
{
    public List<TrackDto> Tracks { get; set; } = new();
    public long UsedBytes { get; set; }
    public long QuotaBytes { get; set; }
}

public class TrackUrlDto
{
    public string Url { get; set; } = "";
}