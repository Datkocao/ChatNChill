import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from './auth.service';
import { ChatHubService } from './chat-hub.service';
import { API_URL } from './config';
import { RoomInviteDto, RoomStateDto, RoomTrackDto } from './models';
import { TrackDto } from './music-api.service';
import { PlayerService, RoomHooks } from './player.service';

const ROOM_KEY = 'chatandchill.roomId';
const SYNC_INTERVAL_MS = 2000;

function loadRoomId(): string | null {
  try { return sessionStorage.getItem(ROOM_KEY); } catch { return null; }
}
function saveRoomId(id: string | null): void {
  try {
    if (id) sessionStorage.setItem(ROOM_KEY, id);
    else sessionStorage.removeItem(ROOM_KEY);
  } catch { /* bỏ qua nếu trình duyệt chặn lưu */ }
}

function toTrackDto(t: RoomTrackDto): TrackDto {
  return {
    id: t.trackId,
    title: t.title,
    artist: t.artist,
    durationSeconds: t.durationSeconds,
    sizeBytes: 0,
    createdAt: '',
    uploaderId: t.addedById,
    origin: 'Upload',
    inLibrary: false,
  };
}

// Singleton ở root, được App tạo sớm để nhận lời mời ở bất kỳ trang nào.
@Injectable({ providedIn: 'root' })
export class RoomService {
  private hub = inject(ChatHubService);
  private player = inject(PlayerService);
  private auth = inject(AuthService);
  private http = inject(HttpClient);

  readonly room = signal<RoomStateDto | null>(null);
  readonly invites = signal<RoomInviteDto[]>([]);
  readonly error = signal<string | null>(null);

  readonly isHost = computed(() => {
    const r = this.room();
    const me = this.auth.user()?.userId;
    return !!r && me != null && r.hostId === me;
  });

  private receivedAt = 0;   // giờ (đồng hồ máy mình) lúc nhận RoomState gần nhất
  private timer: ReturnType<typeof setInterval> | undefined;

  private readonly hooks: RoomHooks = {
    canControl: () => this.isHost(),
    toggle: () => this.ctl(id => (this.room()?.isPlaying ? this.hub.roomPause(id) : this.hub.roomPlay(id))),
    seek: s => this.ctl(id => this.hub.roomSeek(id, s)),
    next: () => this.ctl(id => this.hub.roomNext(id)),
    prev: () => this.ctl(id => this.hub.roomPrev(id)),
    ended: () => {
      const s = this.room();
      if (s && s.currentIndex >= 0) void this.hub.roomTrackEnded(s.id, s.currentIndex).catch(() => { });
    },
    getUrl: trackId =>
      this.http.get<{ url: string }>(`${API_URL}/api/Rooms/${this.room()?.id}/tracks/${trackId}/url`),
  };

  constructor() {
    this.hub.roomState$.subscribe(s => this.onState(s));
    this.hub.roomInvite$.subscribe(i => this.onInvite(i));
    this.hub.roomLeft$.subscribe(id => { if (this.room()?.id === id) this.exit(); });

    // Hub (nối lại) kết nối xong: vào lại phòng đang ở (F5 trang hoặc rớt mạng thoáng qua)
    effect(() => {
      if (this.hub.state() !== 'connected') return;
      untracked(() => void this.restore());
    });

    // Đăng xuất thì thoát phòng
    effect(() => {
      if (!this.auth.user()) untracked(() => { this.invites.set([]); this.exit(); });
    });
  }

  // ---------- Thao tác từ giao diện ----------

  async create(name: string): Promise<void> {
    await this.run(async () => this.accept(await this.hub.createRoom(name)));
  }

  async join(roomId: string): Promise<void> {
    await this.run(async () => {
      try {
        this.accept(await this.hub.joinRoom(roomId));
      } finally {
        this.dismissInvite(roomId);   // dù vào được hay không thì lời mời cũng hết giá trị
      }
    });
  }

  async leave(): Promise<void> {
    const s = this.room();
    if (!s) return;
    await this.run(() => this.hub.leaveRoom(s.id));
    this.exit();
  }

  dismissInvite(roomId: string): void {
    this.invites.update(l => l.filter(i => i.roomId !== roomId));
  }

  invite(friendIds: number[]): void { this.ctl(id => this.hub.inviteToRoom(id, friendIds)); }
  addTrack(trackId: number): void { this.ctl(id => this.hub.roomAddTrack(id, trackId)); }
  removeTrack(index: number): void { this.ctl(id => this.hub.roomRemoveTrack(id, index)); }
  moveTrack(from: number, to: number): void { this.ctl(id => this.hub.roomMoveTrack(id, from, to)); }
  playIndex(index: number): void { this.ctl(id => this.hub.roomPlay(id, index)); }

  // ---------- Nội bộ ----------

  private async run(fn: () => Promise<unknown>): Promise<void> {
    this.error.set(null);
    try {
      await fn();
    } catch (e) {
      this.error.set(e instanceof Error ? e.message : 'Có lỗi xảy ra.');
    }
  }

  // chạy một lệnh trên phòng hiện tại
  private ctl(fn: (roomId: string) => Promise<unknown>): void {
    const s = this.room();
    if (s) void this.run(() => fn(s.id));
  }

  private async restore(): Promise<void> {
    const id = this.room()?.id ?? loadRoomId();
    if (!id) return;
    try {
      this.accept(await this.hub.joinRoom(id));
    } catch {
      this.exit();   // phòng đã đóng hoặc không còn được mời
    }
  }

  private onState(s: RoomStateDto): void {
    const me = this.auth.user()?.userId;
    const cur = this.room();

    if (!s.members.some(m => m.userId === me)) {
      if (cur?.id === s.id) this.exit();
      return;
    }
    if (cur && cur.id === s.id && s.version <= cur.version) return;   // bản cũ hơn
    this.accept(s);
  }

  private onInvite(i: RoomInviteDto): void {
    if (this.room()?.id === i.roomId) return;
    this.invites.update(l => [...l.filter(x => x.roomId !== i.roomId), i]);
  }

  private accept(s: RoomStateDto): void {
    const first = this.room()?.id !== s.id;
    this.room.set(s);
    this.receivedAt = performance.now();
    saveRoomId(s.id);

    if (first) {
      this.player.roomEnter(this.hooks);
      clearInterval(this.timer);
      this.timer = setInterval(() => this.applyToPlayer(), SYNC_INTERVAL_MS);
      this.dismissInvite(s.id);
    }
    this.applyToPlayer();
  }

  private exit(): void {
    saveRoomId(null);
    if (!this.room()) return;
    this.room.set(null);
    clearInterval(this.timer);
    this.player.roomExit();
  }

  private applyToPlayer(): void {
    const s = this.room();
    if (!s) return;
    const t = s.currentIndex >= 0 ? s.queue[s.currentIndex] : null;
    this.player.roomApply(t ? toTrackDto(t) : null, s.isPlaying, this.expected(s));
  }

  // vị trí phát đúng ở thời điểm này
  private expected(s: RoomStateDto): number {
    let pos = s.positionSeconds;
    if (s.isPlaying) pos += (performance.now() - this.receivedAt) / 1000;
    const d = s.currentIndex >= 0 ? s.queue[s.currentIndex]?.durationSeconds : null;
    return d && pos > d ? d : pos;
  }
}