namespace ChatAndChill.Models;

// Ảnh theme trên R2 (key themes/{Name}) và chủ sở hữu, để biết ảnh nào của ai và dọn ảnh không dùng
public class ThemeImage
{
    public string Name { get; set; } = "";     // {guid}{đuôi}, cũng là khoá chính
    public int OwnerId { get; set; }
    public User? Owner { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}