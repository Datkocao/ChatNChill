namespace ChatAndChill.Models
{
    public class User
    {
        public int Id { get; set; }
        public string Username { get; set; } = "";
        public string PasswordHash { get; set; } = "";
        public string? DisplayName { get; set; }
        public string? AvatarUrl { get; set; }
        public string? CoverUrl { get; set; }   
        public string? Bio { get; set; }
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
        public string? AvatarKey { get; set; }
        public string? CoverKey { get; set; }
        public string? PlayerThemeJson { get; set; }   // theme trình phát đã kiểm tra, dạng JSON
    }
}
