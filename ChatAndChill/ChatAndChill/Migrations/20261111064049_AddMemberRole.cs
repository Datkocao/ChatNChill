using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatAndChill.Migrations
{
    /// <inheritdoc />
    public partial class AddMemberRole : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "Role",
                table: "ConversationMembers",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "Role",
                table: "ConversationMembers");
        }
    }
}
