using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatAndChill.Migrations
{
    /// <inheritdoc />
    public partial class AddLastReadMessage : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "LastReadMessageId",
                table: "ConversationMembers",
                type: "bigint",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "LastReadMessageId",
                table: "ConversationMembers");
        }
    }
}
