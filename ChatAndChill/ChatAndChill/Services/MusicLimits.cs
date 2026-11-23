namespace ChatAndChill.Services;

// Giới hạn dùng chung cho upload file và nhập từ link
public static class MusicLimits
{
    public const long MaxFileBytes = 30L * 1024 * 1024;   // 30 MB mỗi bài
    public const long LibraryQuotaBytes = 5L * 1024 * 1024 * 1024;   // trần tổng cho cả kho: 5 GB
    public const int LibraryPageSize = 30;                            // số bài mỗi trang ở "Kho chung"
}