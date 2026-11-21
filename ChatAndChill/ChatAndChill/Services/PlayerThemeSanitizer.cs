using System.Text.Json;
using System.Text.RegularExpressions;

namespace ChatAndChill.Services;

public class PlayerThemeDto
{
    public string Accent { get; set; } = "#3b6df0";
    public string Bg { get; set; } = "#1f2430";
    public string Text { get; set; } = "#ffffff";
    public string BgMode { get; set; } = "solid";
    public string Grad1 { get; set; } = "#3b6df0";
    public string Grad2 { get; set; } = "#8aa7f7";
    public int GradAngle { get; set; } = 135;
    public string? BgImage { get; set; }
    public string? CoverImage { get; set; }
    public int Blur { get; set; }
    public int Overlay { get; set; }
    public int Radius { get; set; }
    public string Layout { get; set; } = "compact";
    public bool ShowCover { get; set; } = true;
    public string CoverShape { get; set; } = "square";
    public string Progress { get; set; } = "thin";
    public bool ShowWave { get; set; }
}

// Kiểm tra lại theme phía server: không tin dữ liệu từ client
public static class PlayerThemeSanitizer
{
    private static readonly Regex Hex = new("^#[0-9a-fA-F]{6}$", RegexOptions.Compiled);
    private static readonly Regex ImagePath = new(
        @"^/api/theme-images/([0-9a-f]{32}\.(?:jpg|jpeg|png|gif|webp))$", RegexOptions.Compiled);

    private static readonly string[] BgModes = { "solid", "gradient", "image" };
    private static readonly string[] Layouts = { "compact", "expanded" };
    private static readonly string[] CoverShapes = { "square", "round" };
    private static readonly string[] ProgressStyles = { "thin", "thick" };

    /// <param name="ownedImages">tên các ảnh theme do chính người này đã upload</param>
    public static PlayerThemeDto Sanitize(JsonElement raw, ISet<string> ownedImages)
    {
        var d = new PlayerThemeDto();
        if (raw.ValueKind != JsonValueKind.Object) return d;

        return new PlayerThemeDto
        {
            Accent = Color(raw, "accent", d.Accent),
            Bg = Color(raw, "bg", d.Bg),
            Text = Color(raw, "text", d.Text),
            BgMode = Pick(raw, "bgMode", BgModes, d.BgMode),
            Grad1 = Color(raw, "grad1", d.Grad1),
            Grad2 = Color(raw, "grad2", d.Grad2),
            GradAngle = Num(raw, "gradAngle", 0, 360, d.GradAngle),
            BgImage = Image(raw, "bgImage", ownedImages),
            CoverImage = Image(raw, "coverImage", ownedImages),
            Blur = Num(raw, "blur", 0, 20, d.Blur),
            Overlay = Num(raw, "overlay", 0, 80, d.Overlay),
            Radius = Num(raw, "radius", 0, 24, d.Radius),
            Layout = Pick(raw, "layout", Layouts, d.Layout),
            ShowCover = raw.TryGetProperty("showCover", out var sc)
                && (sc.ValueKind == JsonValueKind.True || sc.ValueKind == JsonValueKind.False)
                ? sc.GetBoolean() : d.ShowCover,
            ShowWave = raw.TryGetProperty("showWave", out var sw)
    && (sw.ValueKind == JsonValueKind.True || sw.ValueKind == JsonValueKind.False)
    ? sw.GetBoolean() : d.ShowWave,
            CoverShape = Pick(raw, "coverShape", CoverShapes, d.CoverShape),
            Progress = Pick(raw, "progress", ProgressStyles, d.Progress),
        };
    }

    private static string Color(JsonElement raw, string name, string fallback) =>
        raw.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            && Hex.IsMatch(v.GetString()!)
            ? v.GetString()! : fallback;

    private static int Num(JsonElement raw, string name, int min, int max, int fallback)
    {
        if (!raw.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Number
            || !v.TryGetDouble(out var x) || double.IsNaN(x) || double.IsInfinity(x))
            return fallback;
        return (int)Math.Round(Math.Clamp(x, min, max), MidpointRounding.AwayFromZero);
    }

    private static string Pick(JsonElement raw, string name, string[] allowed, string fallback) =>
        raw.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            && allowed.Contains(v.GetString())
            ? v.GetString()! : fallback;

    // chỉ nhận ảnh do chính người này upload; ảnh của người khác hoặc không tồn tại thì bỏ
    private static string? Image(JsonElement raw, string name, ISet<string> owned)
    {
        if (!raw.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String) return null;
        var m = ImagePath.Match(v.GetString()!);
        return m.Success && owned.Contains(m.Groups[1].Value) ? v.GetString() : null;
    }
}