using System.ComponentModel.DataAnnotations;

namespace ChatAndChill.Dtos;

public class StartDirectRequest
{
    [Required]
    public string Username { get; set; } = "";
}

public class MessageDto
{
    public long Id { get; set; }
    public int ConversationId { get; set; }
    public int SenderId { get; set; }
    public string SenderName { get; set; } = "";
    public string? SenderAvatarUrl { get; set; }
    public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public string? AttachmentUrl { get; set; }         // dạng /uploads/xxxx.png
    public string? AttachmentName { get; set; }
    public string? AttachmentContentType { get; set; }
    public long? AttachmentSize { get; set; }
}

public class ConversationDto
{
    public int Id { get; set; }
    public string Type { get; set; } = "";
    public string Name { get; set; } = "";
    public int MemberCount { get; set; }
    public bool IsAdmin { get; set; }
    public int? OtherUserId { get; set; } // chỉ có giá trị với chat 1-1
    public string? OtherAvatarUrl { get; set; } // avatar người kia trong chat 1-1
    public MessageDto? LastMessage { get; set; }

    public class MemberDto
    {
        public int UserId { get; set; }
        public string Username { get; set; } = "";
        public string DisplayName { get; set; } = "";
        public string? AvatarUrl { get; set; }
        public bool IsAdmin { get; set; }
    }

    public class RenameRequest
    {
        [Required, StringLength(50, MinimumLength = 1)]
        public string Name { get; set; } = "";
    }

    public class AddMembersRequest
    {
        public List<string> Usernames { get; set; } = new();
    }

    public class CreateGroupRequest
    {
        [Required, StringLength(50, MinimumLength = 1)]
        public string Name { get; set; } = "";

        public List<string> Usernames { get; set; } = new();
    }
}