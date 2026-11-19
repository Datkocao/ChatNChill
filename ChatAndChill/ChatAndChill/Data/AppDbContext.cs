using ChatAndChill.Models;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();
    public DbSet<Conversation> Conversations => Set<Conversation>();
    public DbSet<ConversationMember> ConversationMembers => Set<ConversationMember>();
    public DbSet<Message> Messages => Set<Message>();
    public DbSet<Friendship> Friendships => Set<Friendship>();
    public DbSet<Track> Tracks => Set<Track>();
    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>()
            .HasIndex(u => u.Username)
            .IsUnique();

        modelBuilder.Entity<ConversationMember>()
            .HasKey(m => new { m.ConversationId, m.UserId });

        modelBuilder.Entity<Message>()
            .HasIndex(m => new { m.ConversationId, m.Id });

        modelBuilder.Entity<Friendship>(e =>
        {
            e.HasOne(f => f.Requester).WithMany().HasForeignKey(f => f.RequesterId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasOne(f => f.Addressee).WithMany().HasForeignKey(f => f.AddresseeId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(f => new { f.RequesterId, f.AddresseeId }).IsUnique();
        });

        modelBuilder.Entity<Track>(e =>
        {
            e.HasOne(t => t.Owner).WithMany().HasForeignKey(t => t.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(t => new { t.OwnerId, t.Id });
        });
    }
}