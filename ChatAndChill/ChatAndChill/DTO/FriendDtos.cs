using System.ComponentModel.DataAnnotations;

namespace ChatAndChill.Dtos;

public class FriendDto
{
    public int UserId { get; set; }
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
}

public class FriendRequestDto
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Direction { get; set; } = "";   // "incoming" hoặc "outgoing"
    public DateTime CreatedAt { get; set; }
}

public class UserSearchDto
{
    public int UserId { get; set; }
    public string Username { get; set; } = "";
    public string DisplayName { get; set; } = "";
    public string Relation { get; set; } = "none";   // none | friend | incoming | outgoing
}

public class SendFriendRequestRequest
{
    [Required]
    public string Username { get; set; } = "";
}