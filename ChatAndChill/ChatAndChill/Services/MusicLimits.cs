namespace ChatAndChill.Services;

// Giới hạn dùng chung cho upload file và nhập từ link
public static class MusicLimits
{
    public const long MaxFileBytes = 30L * 1024 * 1024;   // 30 MB mỗi bài
    public const long QuotaBytes = 200L * 1024 * 1024;    // 200 MB mỗi người
}