using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatAndChill.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerTheme : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "PlayerThemeJson",
                table: "Users",
                type: "text",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "ThemeImages",
                columns: table => new
                {
                    Name = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    OwnerId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ThemeImages", x => x.Name);
                    table.ForeignKey(
                        name: "FK_ThemeImages_Users_OwnerId",
                        column: x => x.OwnerId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ThemeImages_OwnerId",
                table: "ThemeImages",
                column: "OwnerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "ThemeImages");

            migrationBuilder.DropColumn(
                name: "PlayerThemeJson",
                table: "Users");
        }
    }
}
