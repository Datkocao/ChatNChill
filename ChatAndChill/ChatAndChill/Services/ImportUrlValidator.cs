namespace ChatAndChill.Services;

// Chỉ nhận link https của YouTube. Link này sẽ được truyền cho yt-dlp nên phải kiểm tra chặt.
public static class ImportUrlValidator
{
    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"
    };

    public static bool TryNormalize(string? raw, out string url)
    {
        url = "";
        var s = (raw ?? "").Trim();
        if (s.Length == 0 || s.Length > 300) return false;
        if (!Uri.TryCreate(s, UriKind.Absolute, out var uri)) return false;
        if (uri.Scheme != Uri.UriSchemeHttps) return false;
        if (!string.IsNullOrEmpty(uri.UserInfo) || !uri.IsDefaultPort) return false;
        if (!AllowedHosts.Contains(uri.Host)) return false;
        if (uri.AbsoluteUri.Length > 300) return false;

        url = uri.AbsoluteUri;
        return true;
    }
}