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
    public string Content { get; set; } = "";
    public DateTime CreatedAt { get; set; }
}

public class ConversationDto
{
    public int Id { get; set; }
    public string Type { get; set; } = "";
    public string Name { get; set; } = "";
    public MessageDto? LastMessage { get; set; }
}