namespace ChatAndChill.Services;

// Cấu hình công cụ ngoài, lấy từ User Secrets: Tools:Directory
public class ToolsOptions
{
    public string? Directory { get; set; }   // thư mục chứa yt-dlp.exe, ffmpeg.exe, ffprobe.exe
}