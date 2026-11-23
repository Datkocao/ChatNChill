namespace ChatAndChill.Services;

// Kiểm tra và xử lý file ảnh, dùng chung cho ProfileController và ThemeImagesController
public static class ImageFiles
{
    public static readonly HashSet<string> Extensions =
        new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".gif", ".webp" };

    public static string ContentTypeFor(string ext) => ext.ToLowerInvariant() switch
    {
        ".jpg" or ".jpeg" => "image/jpeg",
        ".png" => "image/png",
        ".gif" => "image/gif",
        ".webp" => "image/webp",
        _ => "application/octet-stream"
    };

    // Kiểm tra vài byte đầu file có đúng là ảnh không, tránh đổi đuôi file khác thành .jpg
    public static async Task<bool> LooksLikeImageAsync(IFormFile file)
    {
        var h = new byte[12];
        await using var s = file.OpenReadStream();
        var n = await s.ReadAsync(h, 0, h.Length);
        if (n < 12) return false;

        var jpg = h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF;
        var png = h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47;
        var gif = h[0] == 0x47 && h[1] == 0x49 && h[2] == 0x46 && h[3] == 0x38;
        var webp = h[0] == 0x52 && h[1] == 0x49 && h[2] == 0x46 && h[3] == 0x46
                && h[8] == 0x57 && h[9] == 0x45 && h[10] == 0x42 && h[11] == 0x50;
        return jpg || png || gif || webp;
    }
}