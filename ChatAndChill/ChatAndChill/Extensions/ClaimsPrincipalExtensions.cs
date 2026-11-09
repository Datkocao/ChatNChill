using System.Security.Claims;

namespace ChatAndChill.Extensions;

public static class ClaimsPrincipalExtensions
{
    public static int GetUserId(this ClaimsPrincipal user)
    {
        var value = user.FindFirstValue(ClaimTypes.NameIdentifier)
                    ?? user.FindFirstValue("sub");

        return int.TryParse(value, out var id)
            ? id
            : throw new UnauthorizedAccessException("Token không có id người dùng.");
    }
}