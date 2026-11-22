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
    public DbSet<UserTrack> UserTracks => Set<UserTrack>();
    public DbSet<ThemeImage> ThemeImages => Set<ThemeImage>();
    public DbSet<TrackImport> TrackImports => Set<TrackImport>();
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
        modelBuilder.Entity<ThemeImage>(e =>
            {
                e.HasKey(i => i.Name);
                e.Property(i => i.Name).HasMaxLength(64);
                e.HasOne(i => i.Owner).WithMany().HasForeignKey(i => i.OwnerId)
                    .OnDelete(DeleteBehavior.Cascade);
                e.HasIndex(i => i.OwnerId);
            });
        });

        modelBuilder.Entity<Track>(e =>
        {
            e.HasOne(t => t.Owner).WithMany().HasForeignKey(t => t.UploaderId)
                .OnDelete(DeleteBehavior.Restrict);
            e.HasIndex(t => new { t.UploaderId, t.Id });
            e.Property(t => t.Origin).HasMaxLength(16);
            e.Property(t => t.ContentHash).HasMaxLength(64);
            e.Property(t => t.SourceId).HasMaxLength(100);
            e.HasIndex(t => t.ContentHash).IsUnique();
            e.HasIndex(t => t.SourceId).IsUnique();
        });

        modelBuilder.Entity<TrackImport>(e =>
        {
            e.HasOne(i => i.Owner).WithMany().HasForeignKey(i => i.OwnerId)
                .OnDelete(DeleteBehavior.Cascade);
            e.Property(i => i.Url).HasMaxLength(300);
            e.Property(i => i.Title).HasMaxLength(150);
            e.Property(i => i.Error).HasMaxLength(300);
            e.HasIndex(i => new { i.OwnerId, i.Id });
        });

        modelBuilder.Entity<UserTrack>(e =>
        {
            e.HasKey(x => new { x.UserId, x.TrackId });
            e.HasOne<User>().WithMany().HasForeignKey(x => x.UserId).OnDelete(DeleteBehavior.Cascade);
            e.HasOne<Track>().WithMany().HasForeignKey(x => x.TrackId).OnDelete(DeleteBehavior.Cascade);
            e.HasIndex(x => x.TrackId);   // để đếm nhanh "còn ai dùng bài này"
        });

    }
}