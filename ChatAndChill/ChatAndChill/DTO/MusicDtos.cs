namespace ChatAndChill.Dtos;

public class TrackDto
{
    public int Id { get; set; }
    public string Title { get; set; } = "";
    public string? Artist { get; set; }
    public int? DurationSeconds { get; set; }
    public long SizeBytes { get; set; }
    public DateTime CreatedAt { get; set; }
    public int UploaderId { get; set; }
    public string? UploaderName { get; set; }
    public string Origin { get; set; } = "Upload";   // Upload | Youtube
    public bool InLibrary { get; set; }              // đã nằm trong danh sách của mình chưa
}

public class LibraryPageDto
{
    public List<TrackDto> Tracks { get; set; } = new();
    public int Total { get; set; }
    public int Page { get; set; }
    public int PageSize { get; set; }
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
public class ImportRequest
{
    public string? Url { get; set; }
}

public class ImportDto
{
    public int Id { get; set; }
    public string Url { get; set; } = "";
    public string? Title { get; set; }
    public string Status { get; set; } = "";   // queued | processing | failed
    public string? Error { get; set; }
    public DateTime CreatedAt { get; set; }
}
public class SearchResultDto
{
    public string VideoId { get; set; } = "";
    public string Title { get; set; } = "";
    public string? Channel { get; set; }
    public int DurationSeconds { get; set; }
}