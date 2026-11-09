using System.Security.Claims;
using ChatAndChill.Data;
using ChatAndChill.Dtos;
using ChatAndChill.Models;
using ChatAndChill.Services;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using ChatAndChill.Extensions;

namespace ChatAndChill.Controllers;

[ApiController]
[Route("api/[controller]")]
public class AuthController : ControllerBase
{
    private readonly AppDbContext _db;
    private readonly TokenService _tokens;

    public AuthController(AppDbContext db, TokenService tokens)
    {
        _db = db;
        _tokens = tokens;
    }

    [HttpPost("register")]
    public async Task<ActionResult<AuthResponse>> Register(RegisterRequest req)
    {
        var username = req.Username.Trim().ToLowerInvariant();

        if (await _db.Users.AnyAsync(u => u.Username == username))
            return Conflict(new { message = "Tên đăng nhập đã tồn tại." });

        var user = new User
        {
            Username = username,
            PasswordHash = BCrypt.Net.BCrypt.HashPassword(req.Password),
            DisplayName = string.IsNullOrWhiteSpace(req.DisplayName)
                ? req.Username.Trim()
                : req.DisplayName.Trim()
        };

        _db.Users.Add(user);
        await _db.SaveChangesAsync();

        return Ok(ToResponse(user));
    }

    [HttpPost("login")]
    public async Task<ActionResult<AuthResponse>> Login(LoginRequest req)
    {
        var username = req.Username.Trim().ToLowerInvariant();
        var user = await _db.Users.FirstOrDefaultAsync(u => u.Username == username);

        if (user is null || !BCrypt.Net.BCrypt.Verify(req.Password, user.PasswordHash))
            return Unauthorized(new { message = "Sai tên đăng nhập hoặc mật khẩu." });

        return Ok(ToResponse(user));
    }

    [Authorize]
    [HttpGet("me")]
    public async Task<ActionResult> Me()
    {
        var id = User.GetUserId();
        var user = await _db.Users.FindAsync(id);
        if (user is null) return NotFound();

        return Ok(new { user.Id, user.Username, user.DisplayName, user.AvatarUrl });
    }

    private AuthResponse ToResponse(User user) => new()
    {
        Token = _tokens.CreateToken(user),
        UserId = user.Id,
        Username = user.Username,
        DisplayName = user.DisplayName
    };
}