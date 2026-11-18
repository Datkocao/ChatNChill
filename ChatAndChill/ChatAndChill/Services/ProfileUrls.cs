namespace ChatAndChill.Services;

// Tạo đường dẫn ổn định tới ảnh hồ sơ. Phần ?v= lấy từ tên file nên đổi mỗi lần upload
public static class ProfileUrls
{
    public static string? Avatar(int userId, string? key) => Build(userId, "avatar", key);
    public static string? Cover(int userId, string? key) => Build(userId, "cover", key);

    private static string? Build(int userId, string kind, string? key) =>
        string.IsNullOrEmpty(key)
            ? null
            : $"/api/profile/{userId}/{kind}?v={Path.GetFileNameWithoutExtension(key)}";
}