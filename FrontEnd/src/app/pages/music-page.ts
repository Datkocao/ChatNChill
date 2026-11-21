import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {
  MUSIC_EXTENSIONS,
  MUSIC_MAX_FILE_BYTES,
  MusicApiService,
  TrackDto,
} from '../core/music-api.service';
import { PlayerService } from '../core/player.service';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-music-page',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <div class="top">
        <a routerLink="/chat">← Về chat</a>
       <a routerLink="/music/theme">🎨 Giao diện</a>
        <h2>Thư viện nhạc</h2>
      </div>

      <div class="quota">
        <div class="meter"><div class="fill" [style.width.%]="usedPercent()"></div></div>
        <span>{{ mb(used()) }} / {{ mb(quota()) }} MB</span>
      </div>

      <div class="upload">
        <label class="btn">
          {{ uploading() ? 'Đang tải lên...' : '+ Thêm nhạc' }}
          <input type="file" multiple hidden [disabled]="uploading()"
                 accept=".mp3,.m4a,.ogg,.wav,.flac" (change)="onFiles($event)" />
        </label>
        <span class="hint">mp3, m4a, ogg, wav, flac · tối đa 30 MB mỗi bài</span>
      </div>

      @for (e of errors(); track $index) {
        <div class="error">{{ e }}</div>
      }

      @if (loading()) {
        <p>Đang tải...</p>
      } @else if (tracks().length === 0) {
        <p>Chưa có bài nào. Bấm "Thêm nhạc" để bắt đầu.</p>
      } @else {
        <div class="actions">
          <button (click)="play(0)">▶ Phát tất cả</button>
        </div>
        <ul class="list">
          @for (t of tracks(); track t.id; let i = $index) {
            <li [class.current]="player.currentTrack()?.id === t.id">
              <button class="row" (click)="play(i)">
                <span class="idx">{{ player.currentTrack()?.id === t.id && player.isPlaying() ? '🔊' : i + 1 }}</span>
                <span class="meta">
                  <span class="title">{{ t.title }}</span>
                  <span class="artist">{{ t.artist || 'Không rõ nghệ sĩ' }}</span>
                </span>
                <span class="dur">{{ fmt(t.durationSeconds) }}</span>
                <span class="size">{{ mb(t.sizeBytes) }} MB</span>
              </button>
              <button class="del" (click)="remove(t)" title="Xoá">🗑</button>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .wrap { max-width: 760px; margin: 0 auto; padding: 16px 16px 100px; }
    .top { display: flex; align-items: center; gap: 16px; }
    .top h2 { margin: 0; }
    .quota { display: flex; align-items: center; gap: 10px; margin: 12px 0; font-size: 13px; }
    .meter { flex: 1; height: 8px; background: #e3e6ec; border-radius: 4px; overflow: hidden; }
    .fill { height: 100%; background: #4f7cff; }
    .upload { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
    .btn { background: #4f7cff; color: #fff; padding: 8px 14px; border-radius: 8px; cursor: pointer; }
    .hint { font-size: 12px; color: #777; }
    .error { background: #fdecec; color: #b3261e; padding: 6px 10px; border-radius: 6px; margin: 4px 0; font-size: 13px; }
    .actions { margin: 12px 0 6px; }
    .list { list-style: none; margin: 0; padding: 0; }
    .list li { display: flex; align-items: center; border-bottom: 1px solid #eee; }
    .list li.current { background: #eef3ff; }
    .row {
      flex: 1; display: grid; grid-template-columns: 32px 1fr 56px 72px; align-items: center;
      gap: 8px; padding: 8px 6px; background: none; border: none; text-align: left; cursor: pointer; font: inherit;
    }
    .meta { display: flex; flex-direction: column; min-width: 0; }
    .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .artist { font-size: 12px; color: #777; }
    .dur, .size { font-size: 12px; color: #777; text-align: right; }
    .del { background: none; border: none; cursor: pointer; font-size: 16px; padding: 8px; }
  `,
})
export class MusicPage implements OnInit {
  private api = inject(MusicApiService);
  private auth = inject(AuthService);
  protected player = inject(PlayerService);

  protected tracks = signal<TrackDto[]>([]);
  protected used = signal(0);
  protected quota = signal(0);
  protected loading = signal(true);
  protected uploading = signal(false);
  protected errors = signal<string[]>([]);
  protected usedPercent = computed(() =>
    this.quota() > 0 ? Math.min(100, (this.used() / this.quota()) * 100) : 0);

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    this.api.list().subscribe({
      next: r => {
        this.tracks.set(r.tracks);
        this.used.set(r.usedBytes);
        this.quota.set(r.quotaBytes);
        this.loading.set(false);
      },
      error: e => {
        this.loading.set(false);
        this.errors.set([this.msg(e, 'Không tải được thư viện nhạc.')]);
      },
    });
  }

  protected play(index: number): void {
    this.player.playList(this.tracks(), index);
  }

  protected async onFiles(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
    if (files.length === 0) return;

    this.errors.set([]);
    this.uploading.set(true);
    const errs: string[] = [];

    for (const file of files) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      if (!MUSIC_EXTENSIONS.includes(ext)) {
        errs.push(`"${file.name}": định dạng không được hỗ trợ.`);
        continue;
      }
      if (file.size > MUSIC_MAX_FILE_BYTES) {
        errs.push(`"${file.name}": quá lớn (tối đa 30 MB).`);
        continue;
      }
      try {
        const duration = await this.api.readDuration(file);
        await firstValueFrom(this.api.upload(file, undefined, undefined, duration));
      } catch (e) {
        errs.push(`"${file.name}": ${this.msg(e, 'tải lên thất bại.')}`);
      }
    }

    this.uploading.set(false);
    this.errors.set(errs);
    this.reload();
  }

  protected remove(t: TrackDto): void {
    if (!confirm(`Xoá "${t.title}" khỏi thư viện?`)) return;
    this.api.delete(t.id).subscribe({
      next: () => {
        this.player.removeTrack(t.id);
        this.reload();
      },
      error: e => this.errors.set([this.msg(e, 'Không xoá được bài.')]),
    });
  }

  protected mb(bytes: number): string {
    return (bytes / 1024 / 1024).toFixed(1);
  }

  protected fmt(s: number | null): string {
    if (!s) return '';
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  }

  private msg(e: any, fallback: string): string {
    return e?.error?.message ?? fallback;
  }
}