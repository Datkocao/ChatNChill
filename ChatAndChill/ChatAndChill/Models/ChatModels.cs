namespace ChatAndChill.Models;

public enum ConversationType
{
    Direct = 0,
    Group = 1
}
public enum MemberRole
{
    Member = 0,
    Admin = 1
}

public class Conversation
{
    public int Id { get; set; }
    public ConversationType Type { get; set; }
    public string? Name { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public List<ConversationMember> Members { get; set; } = new();
    public List<Message> Messages { get; set; } = new();
}

public class ConversationMember
{
    public int ConversationId { get; set; }
    public Conversation Conversation { get; set; } = null!;

    public int UserId { get; set; }
    public User User { get; set; } = null!;

    public DateTime JoinedAt { get; set; } = DateTime.UtcNow;
    public MemberRole Role { get; set; } = MemberRole.Member;
    public long? LastReadMessageId { get; set; } // tin cuối mà thành viên này đã đọc
}


public class Message
{
    public long Id { get; set; }

    public int ConversationId { get; set; }
    public Conversation Conversation { get; set; } = null!;

    public int SenderId { get; set; }
    public User Sender { get; set; } = null!;

    public string Content { get; set; } = "";
    public string? AttachmentPath { get; set; }        // tên file trên đĩa (GUID + đuôi)
    public string? AttachmentName { get; set; }        // tên gốc để hiển thị
    public string? AttachmentContentType { get; set; } // ví dụ image/png
    public long? AttachmentSize { get; set; }          // byte
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
}

