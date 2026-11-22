using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace ChatAndChill.Migrations
{
    /// <inheritdoc />
    public partial class SharedMusicLibrary : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Tracks_Users_OwnerId",
                table: "Tracks");

            migrationBuilder.RenameColumn(
                name: "OwnerId",
                table: "Tracks",
                newName: "UploaderId");

            migrationBuilder.RenameIndex(
                name: "IX_Tracks_OwnerId_Id",
                table: "Tracks",
                newName: "IX_Tracks_UploaderId_Id");

            migrationBuilder.AddColumn<string>(
                name: "ContentHash",
                table: "Tracks",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "Origin",
                table: "Tracks",
                type: "character varying(16)",
                maxLength: 16,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "SourceId",
                table: "Tracks",
                type: "character varying(100)",
                maxLength: 100,
                nullable: true);

            migrationBuilder.CreateTable(
                name: "UserTracks",
                columns: table => new
                {
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    TrackId = table.Column<int>(type: "integer", nullable: false),
                    AddedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_UserTracks", x => new { x.UserId, x.TrackId });
                    table.ForeignKey(
                        name: "FK_UserTracks_Tracks_TrackId",
                        column: x => x.TrackId,
                        principalTable: "Tracks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_UserTracks_Users_UserId",
                        column: x => x.UserId,
                        principalTable: "Users",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_Tracks_ContentHash",
                table: "Tracks",
                column: "ContentHash",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Tracks_SourceId",
                table: "Tracks",
                column: "SourceId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_UserTracks_TrackId",
                table: "UserTracks",
                column: "TrackId");

            migrationBuilder.AddForeignKey(
                name: "FK_Tracks_Users_UploaderId",
                table: "Tracks",
                column: "UploaderId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.Sql(@"
    INSERT INTO ""UserTracks"" (""UserId"", ""TrackId"", ""AddedAt"")
    SELECT ""UploaderId"", ""Id"", ""CreatedAt"" FROM ""Tracks"";
");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Tracks_Users_UploaderId",
                table: "Tracks");

            migrationBuilder.DropTable(
                name: "UserTracks");

            migrationBuilder.DropIndex(
                name: "IX_Tracks_ContentHash",
                table: "Tracks");

            migrationBuilder.DropIndex(
                name: "IX_Tracks_SourceId",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "ContentHash",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "Origin",
                table: "Tracks");

            migrationBuilder.DropColumn(
                name: "SourceId",
                table: "Tracks");

            migrationBuilder.RenameColumn(
                name: "UploaderId",
                table: "Tracks",
                newName: "OwnerId");

            migrationBuilder.RenameIndex(
                name: "IX_Tracks_UploaderId_Id",
                table: "Tracks",
                newName: "IX_Tracks_OwnerId_Id");

            migrationBuilder.AddForeignKey(
                name: "FK_Tracks_Users_OwnerId",
                table: "Tracks",
                column: "OwnerId",
                principalTable: "Users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
