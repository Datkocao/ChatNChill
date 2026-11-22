import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Observable, firstValueFrom } from 'rxjs';
import { MusicApiService, TrackDto } from './music-api.service';
import { AuthService } from './auth.service';


export type RepeatMode = 'off' | 'one' | 'list';
const VOLUME_KEY = 'chatandchill.playerVolume';

// đọc âm lượng lần trước, ép về 0-1; lần đầu hoặc dữ liệu hỏng thì dùng 1
function loadVolume(): number {
    try {
        const v = parseFloat(localStorage.getItem(VOLUME_KEY) ?? '');
        return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1;
    } catch {
        return 1;
    }
}

// RoomService đưa vào khi đang nghe theo phòng; PlayerService chỉ gọi lại các hàm này
export interface RoomHooks {
    canControl: () => boolean;                 // true nếu là chủ phòng
    toggle: () => void;
    seek: (seconds: number) => void;
    next: () => void;
    prev: () => void;
    ended: () => void;                         // thẻ audio phát hết bài
    getUrl: (trackId: number) => Observable<{ url: string }>;
}

function saveVolume(v: number): void {
    try {
        localStorage.setItem(VOLUME_KEY, String(v));
    } catch {
        /* bỏ qua nếu trình duyệt chặn lưu */
    }
}

// Singleton ở root: nhạc không bị ngắt khi chuyển trang.
@Injectable({ providedIn: 'root' })
export class PlayerService {
    private api = inject(MusicApiService);
    private auth = inject(AuthService);
    private audio = new Audio();
    private loadSeq = 0;          // bỏ qua kết quả của lần tải cũ
    private urlRetried = false;   // đã xin link mới 1 lần cho bài này chưa
    private ctx: AudioContext | null = null;
    private analyserNode: AnalyserNode | null = null;

    // Danh sách đang phát và thứ tự phát (chỉ số trong queue)
    readonly queue = signal<TrackDto[]>([]);
    private order = signal<number[]>([]);
    private pos = signal(-1);

    readonly currentTrack = computed(() => {
        const p = this.pos();
        const o = this.order();
        if (p < 0 || p >= o.length) return null;
        return this.queue()[o[p]] ?? null;
    });

    readonly isPlaying = signal(false);
    readonly loading = signal(false);
    readonly error = signal<string | null>(null);
    readonly currentTime = signal(0);
    readonly duration = signal(0);
    readonly volume = signal(loadVolume());

    readonly shuffle = signal(false);
    readonly repeatMode = signal<RepeatMode>('off');
    // Số lần lặp LẠI thêm (vd 2 = phát tổng cộng 3 lần). null = vô hạn.
    readonly repeatLimit = signal<number | null>(null);
    readonly repeatsDone = signal(0);
    private roomHooks = signal<RoomHooks | null>(null);
    readonly inRoom = computed(() => this.roomHooks() !== null);
    /** Ngoài phòng luôn true; trong phòng chỉ chủ phòng là true. */
    readonly canControl = computed(() => this.roomHooks()?.canControl() ?? true);



    constructor() {
        // Đăng xuất (hoặc hết phiên) thì dừng nhạc và xoá danh sách phát
        effect(() => {
            if (!this.auth.user()) untracked(() => this.clear());
        });
        const a = this.audio;
        a.preload = 'metadata';
        a.crossOrigin = 'anonymous'; // cần cho Web Audio
        a.volume = this.volume();
        a.addEventListener('play', () => {
            this.isPlaying.set(true);
            a.addEventListener('play', () => {
            this.isPlaying.set(true);
            this.error.set(null);
            void this.ctx?.resume();
        });
            void this.ctx?.resume(); // trình duyệt có thể đang tạm dừng AudioContext
        });
        a.addEventListener('pause', () => this.isPlaying.set(false));
        a.addEventListener('timeupdate', () => this.currentTime.set(a.currentTime));
        a.addEventListener('durationchange', () =>
            this.duration.set(isFinite(a.duration) ? a.duration : 0));
        a.addEventListener('ended', () => this.onEnded());
        a.addEventListener('error', () => this.onAudioError());
    }

    // ---------- Phát ----------

    /** Phát cả danh sách, bắt đầu từ bài thứ startIndex. */
    playList(tracks: TrackDto[], startIndex = 0): void {
        if (this.roomHooks()) {
            this.error.set('Đang trong phòng nghe nhạc, hãy rời phòng để phát nhạc riêng.');
            setTimeout(() => { if (!this.isPlaying()) this.error.set(null); }, 3000);
            return;
        }
        if (tracks.length === 0) return;
        this.queue.set([...tracks]);
        this.repeatsDone.set(0);
        this.buildOrder(Math.min(Math.max(startIndex, 0), tracks.length - 1));
        void this.load(true);
    }

    /** Chỉ phát đúng một bài. */
    playSingle(track: TrackDto): void {
        this.playList([track], 0);
    }

    toggle(): void {
                const h = this.roomHooks();
        if (h) {
            if (h.canControl()) h.toggle();
            else if (this.audio.paused && this.audio.getAttribute('src')) this.audio.play().catch(() => { });
            return;   // người thường chỉ bấm được "phát lại" khi trình duyệt chặn tự phát
        }
        if (!this.currentTrack()) return;
        if (!this.audio.paused) {
            this.audio.pause();
            return;
        }
        if (this.audio.getAttribute('src')) this.audio.play().catch(() => { });
        else void this.load(true);
    }

    next(): void {
                const h = this.roomHooks();
        if (h) { if (h.canControl()) h.next(); return; }
        if (!this.currentTrack()) return;
        const p = this.pos() + 1;
        if (p < this.order().length) {
            this.pos.set(p);
        } else {
            this.restartList(); // đang ở cuối: quay về bài đầu
        }
        void this.load(true);
    }

    prev(): void {
                const h = this.roomHooks();
        if (h) { if (h.canControl()) h.prev(); return; }
        if (!this.currentTrack()) return;
        // Phát quá 3 giây thì Prev chỉ tua về đầu bài hiện tại
        if (this.audio.currentTime > 3) {
            this.seek(0);
            return;
        }
        const p = this.pos() - 1;
        // đang ở đầu: nhảy xuống bài cuối
        this.pos.set(p >= 0 ? p : this.order().length - 1);
        void this.load(true);
    }
    seek(seconds: number): void {
                const h = this.roomHooks();
        if (h) { if (h.canControl()) h.seek(seconds); return; }
        this.audio.currentTime = seconds;
        this.currentTime.set(seconds);
    }

    setVolume(v: number): void {
        const x = Math.min(1, Math.max(0, v));
        this.volume.set(x);
        this.audio.volume = x;
        saveVolume(x);
    }

    /**
 * Nối thẻ audio vào bộ phân tích âm thanh để vẽ sóng nhạc.
 * Chỉ tạo một lần (createMediaElementSource chỉ gọi được một lần cho mỗi thẻ audio).
 * Trả null nếu trình duyệt không hỗ trợ.
 */
    getAnalyser(): AnalyserNode | null {
        if (this.analyserNode) return this.analyserNode;
        try {
            const ctx = new AudioContext();
            const source = ctx.createMediaElementSource(this.audio);
            const analyser = ctx.createAnalyser();
            analyser.fftSize = 128;
            analyser.smoothingTimeConstant = 0.8;
            source.connect(analyser);
            analyser.connect(ctx.destination);
            this.ctx = ctx;
            this.analyserNode = analyser;
            void ctx.resume();
            return analyser;
        } catch {
            return null;
        }
    }

    toggleShuffle(): void {
        const p = this.pos();
        const idx = p >= 0 ? this.order()[p] : 0;
        this.shuffle.update(v => !v);
        this.buildOrder(idx);
    }

    setRepeat(mode: RepeatMode, limit: number | null = null): void {
        this.repeatMode.set(mode);
        this.repeatLimit.set(limit);
        this.repeatsDone.set(0);
    }

    /** Gọi khi người dùng xoá bài khỏi thư viện. */
    removeTrack(id: number): void {
        if (this.roomHooks()) return;
        const q = this.queue();
        const removedIdx = q.findIndex(t => t.id === id);
        if (removedIdx < 0) return;

        const p = this.pos();
        const curIdx = p >= 0 ? this.order()[p] : -1;
        const newQ = q.filter(t => t.id !== id);
        this.queue.set(newQ);

        if (newQ.length === 0) {
            this.clear();
        } else if (removedIdx === curIdx) {
            const wasPlaying = this.isPlaying();
            this.buildOrder(Math.min(removedIdx, newQ.length - 1));
            void this.load(wasPlaying);
        } else {
            this.buildOrder(removedIdx < curIdx ? curIdx - 1 : curIdx);
        }
    }

        // ---------- Phòng nghe nhạc (do RoomService điều khiển) ----------

    roomEnter(hooks: RoomHooks): void {
        this.clear();                    // dừng nhạc riêng
        this.shuffle.set(false);
        this.repeatMode.set('off');
        this.roomHooks.set(hooks);
    }

    roomExit(): void {
        if (!this.roomHooks()) return;
        this.roomHooks.set(null);
        this.clear();
    }

    /** Đưa thẻ audio về đúng trạng thái của phòng. Gọi mỗi khi có RoomState mới và mỗi 2 giây. */
    roomApply(track: TrackDto | null, playing: boolean, position: number): void {
        if (!this.roomHooks()) return;
        if (!track) { this.clear(); return; }

        const cur = this.currentTrack();
        const a = this.audio;

        if (!cur || cur.id !== track.id || !a.getAttribute('src')) {
            if (cur?.id === track.id && (this.loading() || this.error())) return;
            this.queue.set([track]);
            this.order.set([0]);
            this.pos.set(0);
            this.repeatsDone.set(0);
            void this.load(playing, position);
            return;
        }

        if (this.loading()) return;

        if (Math.abs(a.currentTime - position) > (playing ? 1.5 : 0.3)) {
            a.currentTime = position;
            this.currentTime.set(position);
        }
        if (playing && a.paused) a.play().catch(() => { });
        else if (!playing && !a.paused) a.pause();
    }

    // ---------- Nội bộ ----------

    private canRepeat(): boolean {
        const limit = this.repeatLimit();
        return limit === null || this.repeatsDone() < limit;
    }

    private onEnded(): void {
                const h = this.roomHooks();
        if (h) { h.ended(); return; }   // trong phòng thì server quyết định bài tiếp theo
        const mode = this.repeatMode();

        if (mode === 'one' && this.canRepeat()) {
            this.repeatsDone.update(n => n + 1);
            this.audio.currentTime = 0;
            this.audio.play().catch(() => { });
            return;
        }

        const p = this.pos() + 1;
        if (p < this.order().length) {
            this.pos.set(p);
            void this.load(true);
            return;
        }

        if (mode === 'list' && this.canRepeat()) {
            this.repeatsDone.update(n => n + 1);
            this.restartList();
            void this.load(true);
            return;
        }

        // Hết danh sách: về đầu và dừng
        this.pos.set(0);
        void this.load(false);
    }

    private onAudioError(): void {
        if (!this.audio.getAttribute('src')) return;
        // Link có hạn 6 giờ: thử xin link mới một lần rồi phát tiếp từ vị trí cũ
        if (!this.urlRetried) {
            this.urlRetried = true;
            void this.load(this.isPlaying(), this.audio.currentTime, true);
            return;
        }
        this.isPlaying.set(false);
        this.loading.set(false);
        this.error.set('Không phát được bài này.');
    }

    private restartList(): void {
        const n = this.queue().length;
        this.buildOrder(this.shuffle() ? Math.floor(Math.random() * n) : 0);
    }

    private buildOrder(currentIndex: number): void {
        const n = this.queue().length;
        if (n === 0) {
            this.order.set([]);
            this.pos.set(-1);
            return;
        }
        const all = Array.from({ length: n }, (_, i) => i);
        if (this.shuffle()) {
            const rest = all.filter(i => i !== currentIndex);
            for (let i = rest.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [rest[i], rest[j]] = [rest[j], rest[i]];
            }
            this.order.set([currentIndex, ...rest]);
            this.pos.set(0);
        } else {
            this.order.set(all);
            this.pos.set(currentIndex);
        }
    }

    private async load(autoplay: boolean, resumeAt = 0, isRetry = false): Promise<void> {
        const track = this.currentTrack();
        const seq = ++this.loadSeq;
        if (!isRetry) this.urlRetried = false;
        if (!track) {
            this.clear();
            return;
        }

        this.currentTime.set(resumeAt);
        this.duration.set(track.durationSeconds ?? 0);
        this.loading.set(true);
        this.error.set(null);

        try {
            const hooks = this.roomHooks();
            const { url } = await firstValueFrom(hooks ? hooks.getUrl(track.id) : this.api.getUrl(track.id));
            if (seq !== this.loadSeq) return;
            this.audio.src = url;
            this.audio.volume = this.volume();
            if (resumeAt > 0) this.audio.currentTime = resumeAt;
            if (autoplay) await this.audio.play();
        } catch (e) {
            if (seq !== this.loadSeq) return;
            if (e instanceof DOMException) {
                if (e.name !== 'AbortError') this.error.set('Trình duyệt chặn tự phát, hãy bấm Phát.');
            } else {
                this.error.set('Không lấy được link phát bài này.');
            }
        } finally {
            if (seq === this.loadSeq) this.loading.set(false);
        }
    }

    private clear(): void {
        this.loadSeq++;
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio.load();
        this.queue.set([]);
        this.order.set([]);
        this.pos.set(-1);
        this.currentTime.set(0);
        this.duration.set(0);
        this.isPlaying.set(false);
        this.loading.set(false);
    }
}