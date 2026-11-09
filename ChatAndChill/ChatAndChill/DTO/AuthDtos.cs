using System.ComponentModel.DataAnnotations;

namespace ChatAndChill.Dtos;

public class RegisterRequest
{
    [Required, StringLength(30, MinimumLength = 3)]
    public string Username { get; set; } = "";

    [Required, StringLength(100, MinimumLength = 6)]
    public string Password { get; set; } = "";

    public string? DisplayName { get; set; }
}

public class LoginRequest
{
    [Required]
    public string Username { get; set; } = "";

    [Required]
    public string Password { get; set; } = "";
}

public class AuthResponse
{
    public string Token { get; set; } = "";
    public int UserId { get; set; }
    public string Username { get; set; } = "";
    public string? DisplayName { get; set; }
}