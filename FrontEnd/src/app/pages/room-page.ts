import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { FriendsApiService } from '../core/friends-api.service';
import { FriendDto, RoomTrackDto } from '../core/models';
import { LibraryPage, MusicApiService } from '../core/music-api.service';
import { RoomService } from '../core/room.service';

@Component({
  selector: 'app-room-page',
  imports: [RouterLink],
  template: `
        <div class="page" [class.themed]="rooms.room() !== null">
    <div class="wrap">
      <div class="top">
        <a routerLink="/chat">← Chat</a>
        <a routerLink="/music">🎵 Thư viện</a>
      </div>

      @if (rooms.error()) {
        <p class="error">{{ rooms.error() }}</p>
      }

      @if (rooms.room(); as r) {
        <header class="head">
          <div>
            <h2>{{ r.name }}</h2>
            <small>{{ rooms.isHost() ? 'Bạn là chủ phòng, chỉ bạn điều khiển được nhạc.' : 'Chủ phòng điều khiển nhạc, bạn thêm bài và chỉnh âm lượng riêng.' }}</small>
          </div>
          <button type="button" class="danger" (click)="rooms.leave()">Rời phòng</button>
        </header>

        <section>
          <h4>Thành viên ({{ r.members.length }})</h4>
          <div class="members">
            @for (m of r.members; track m.userId) {
              <span class="chip">{{ m.name }}@if (m.userId === r.hostId) { 👑 }</span>
            }
          </div>
          <button type="button" class="plain" (click)="toggleInvite()">{{ showInvite() ? 'Đóng' : '+ Mời bạn bè' }}</button>
          @if (showInvite()) {
            <div class="box">
              @for (f of invitable(); track f.userId) {
                <label class="row">
                  <input type="checkbox" [checked]="selected().has(f.userId)" (change)="toggleFriend(f.userId)" />
                  {{ f.displayName }} <small>&#64;{{ f.username }}</small>
                </label>
              } @empty {
                <p class="muted">Không còn bạn bè nào để mời.</p>
              }
              @if (invitable().length > 0) {
                <button type="button" class="primary" [disabled]="selected().size === 0" (click)="sendInvite()">Gửi lời mời</button>
              }
            </div>
          }
        </section>

        <section>
          <h4>Danh sách phát ({{ r.queue.length }})</h4>
          @for (t of r.queue; track $index) {
            <div class="row track" [class.cur]="$index === r.currentIndex">
              <span class="idx">{{ $index === r.currentIndex ? (r.isPlaying ? '▶' : '⏸') : $index + 1 }}</span>
              <span class="grow">
                <b>{{ t.title }}</b>
                <small>{{ t.artist || 'Không rõ nghệ sĩ' }} · {{ fmt(t.durationSeconds) }}</small>
              </span>
              @if (rooms.isHost()) {
                <button type="button" class="plain" title="Phát bài này" (click)="rooms.playIndex($index)">▶</button>
                <button type="button" class="plain" title="Lên trước" [disabled]="$index === 0" (click)="rooms.moveTrack($index, $index - 1)">↑</button>
                <button type="button" class="plain" title="Ra sau" [disabled]="$index === r.queue.length - 1" (click)="rooms.moveTrack($index, $index + 1)">↓</button>
              }
              @if (canRemove(t)) {
                <button type="button" class="danger" title="Xoá khỏi danh sách" (click)="rooms.removeTrack($index)">🗑</button>
              }
            </div>
          } @empty {
            <p class="muted">Chưa có bài nào. Thêm bài từ kho chung ở dưới.</p>
          }
        </section>

        <section>
          <h4>Thêm bài từ kho chung</h4>
          <div class="search">
            <input placeholder="Tìm theo tên bài hoặc nghệ sĩ..." [value]="q()"
                   (input)="q.set($any($event.target).value)" (keyup.enter)="search(1)" />
            <button type="button" class="primary" (click)="search(1)">Tìm</button>
          </div>
          @if (lib(); as l) {
            @for (t of l.tracks; track t.id) {
              <div class="row">
                <span class="grow">
                  <b>{{ t.title }}</b>
                  <small>{{ t.artist || 'Không rõ nghệ sĩ' }} · {{ fmt(t.durationSeconds) }}</small>
                </span>
                <button type="button" class="plain" (click)="rooms.addTrack(t.id)">+ Thêm</button>
              </div>
            } @empty {
              <p class="muted">Không tìm thấy bài nào.</p>
            }
            @if (totalPages() > 1) {
              <div class="pager">
                <button type="button" class="plain" [disabled]="l.page <= 1" (click)="search(l.page - 1)">‹</button>
                <span>{{ l.page }} / {{ totalPages() }}</span>
                <button type="button" class="plain" [disabled]="l.page >= totalPages()" (click)="search(l.page + 1)">›</button>
              </div>
            }
          } @else if (libLoading()) {
            <p class="muted">Đang tải...</p>
          }
        </section>
      } @else {
        <h2>Phòng nghe nhạc</h2>
        <p class="muted">Tạo phòng rồi mời bạn bè vào để nghe chung. Khi bạn bè mời, khung "Tham gia" sẽ hiện ở góc phải màn hình, ở bất kỳ trang nào.</p>
        <div class="search">
          <input placeholder="Tên phòng (có thể để trống)" [value]="newName()"
                 (input)="newName.set($any($event.target).value)" (keyup.enter)="create()" />
          <button type="button" class="primary" (click)="create()">Tạo phòng</button>
        </div>
      }
    </div>
    </div>
  `,
    styles: `
    :host { display: block; }
    .page { min-height: 100vh; box-sizing: border-box; padding-bottom: calc(24px + var(--player-h, 0px)); background: #f2f4f8; }
    .wrap { max-width: 760px; margin: 0 auto; padding: 16px; }
    .top { display: flex; justify-content: space-between; margin-bottom: 8px; }
    .top a { color: #3b6df0; text-decoration: none; }
    h2 { margin: 8px 0; } h4 { margin: 0 0 8px; }
    .head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .head small, .muted { color: #667085; }
    section { background: #fff; border: 1px solid #e3e7ee; border-radius: 12px; padding: 14px; margin-top: 14px; }
    .members { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .chip { background: #e4ebfd; color: #3b6df0; border-radius: 999px; padding: 3px 10px; font-size: 13px; }
    .box { margin-top: 8px; padding: 8px; border: 1px solid #e3e7ee; border-radius: 10px; display: flex; flex-direction: column; gap: 6px; }
    .row { display: flex; align-items: center; gap: 8px; padding: 6px 4px; border-bottom: 1px solid #eef1f6; }
    .row:last-child { border-bottom: 0; }
    .row.track.cur { background: #e4ebfd; border-radius: 8px; }
    .idx { width: 22px; text-align: center; color: #667085; }
    .grow { flex: 1; min-width: 0; }
    .grow b, .grow small { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    small { color: #667085; }
    .search { display: flex; gap: 8px; margin-bottom: 8px; }
    .search input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #cfd6e0; border-radius: 8px; }
    .pager { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 8px; }
    .primary { background: #3b6df0; color: #fff; border: 0; border-radius: 8px; padding: 8px 14px; cursor: pointer; }
    .plain { background: none; border: 1px solid #cfd6e0; color: #344054; border-radius: 8px; padding: 5px 10px; cursor: pointer; }
    .danger { background: #fdecea; color: #c62828; border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
    button[disabled] { opacity: .45; cursor: default; }
    .error { color: #c62828; }

    /* trong phòng: dùng giao diện (biến --pt-*) của chủ phòng */
    .page.themed {
      color: var(--pt-text);
      background:
        linear-gradient(rgba(0, 0, 0, var(--pt-overlay, 0)), rgba(0, 0, 0, var(--pt-overlay, 0))),
        var(--pt-bg-image, none) center / cover no-repeat,
        var(--pt-bg);
    }
    .page.themed .top a { color: var(--pt-accent); }
    .page.themed small, .page.themed .muted, .page.themed .idx { color: inherit; opacity: .7; }
    .page.themed section { background: color-mix(in srgb, var(--pt-text) 8%, transparent); border-color: color-mix(in srgb, var(--pt-text) 20%, transparent); }
    .page.themed .box { border-color: color-mix(in srgb, var(--pt-text) 20%, transparent); }
    .page.themed .row { border-bottom-color: color-mix(in srgb, var(--pt-text) 15%, transparent); }
    .page.themed .row.track.cur { background: color-mix(in srgb, var(--pt-accent) 30%, transparent); }
    .page.themed .chip { background: color-mix(in srgb, var(--pt-accent) 30%, transparent); color: var(--pt-text); }
    .page.themed .plain { color: inherit; border-color: color-mix(in srgb, var(--pt-text) 30%, transparent); }
    .page.themed .primary { background: color-mix(in srgb, var(--pt-accent) 35%, transparent); color: var(--pt-text); border: 1px solid var(--pt-accent); }
  `,
})
export class RoomPage {
  protected rooms = inject(RoomService);
  private auth = inject(AuthService);
  private music = inject(MusicApiService);
  private friendsApi = inject(FriendsApiService);

  protected newName = signal('');

  // tìm bài trong kho chung
  protected q = signal('');
  protected lib = signal<LibraryPage | null>(null);
  protected libLoading = signal(false);
  protected totalPages = computed(() => {
    const l = this.lib();
    return l ? Math.max(1, Math.ceil(l.total / l.pageSize)) : 1;
  });

  // mời bạn bè
  protected showInvite = signal(false);
  protected friends = signal<FriendDto[]>([]);
  protected selected = signal<Set<number>>(new Set());
  protected invitable = computed(() => {
    const inRoom = new Set(this.rooms.room()?.members.map(m => m.userId) ?? []);
    return this.friends().filter(f => !inRoom.has(f.userId));
  });

  constructor() {
    this.search(1);
  }

  protected create(): void {
    void this.rooms.create(this.newName().trim());
    this.newName.set('');
  }

  protected search(page: number): void {
    this.libLoading.set(true);
    this.music.library(this.q().trim(), page).subscribe({
      next: l => { this.lib.set(l); this.libLoading.set(false); },
      error: () => { this.libLoading.set(false); },
    });
  }

  protected toggleInvite(): void {
    const open = !this.showInvite();
    this.showInvite.set(open);
    if (open) {
      this.selected.set(new Set());
      this.friendsApi.friends().subscribe({ next: list => this.friends.set(list) });
    }
  }

  protected toggleFriend(id: number): void {
    this.selected.update(s => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  protected sendInvite(): void {
    this.rooms.invite([...this.selected()]);
    this.selected.set(new Set());
    this.showInvite.set(false);
  }

  // chủ phòng xoá được mọi bài, người khác chỉ xoá được bài mình thêm
  protected canRemove(t: RoomTrackDto): boolean {
    return this.rooms.isHost() || t.addedById === this.auth.user()?.userId;
  }

  protected fmt(s: number | null): string {
    if (s == null || !isFinite(s) || s < 0) return '--:--';
    return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, '0')}`;
  }
}