using ChatAndChill.Models;
using Microsoft.EntityFrameworkCore;
using ChatAndChill.Data;
using Microsoft.EntityFrameworkCore;

namespace ChatAndChill.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    public DbSet<User> Users => Set<User>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>()
            .HasIndex(u => u.Username)
            .IsUnique();
    }
}   