import { Component, OnInit, computed, inject, signal, OnDestroy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import {MUSIC_EXTENSIONS,MUSIC_MAX_FILE_BYTES,MusicApiService,SearchResult, TrackDto,} from '../core/music-api.service';
import { PlayerService } from '../core/player.service';
import { AuthService } from '../core/auth.service';
import { ImportApiService, ImportDto } from '../core/import-api.service';

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
                <span>Kho chung: {{ size(used()) }} / {{ size(quota()) }}</span>
      </div>

            <div class="tabs">
        <button [class.on]="tab() === 'mine'" (click)="setTab('mine')">Danh sách của tôi</button>
        <button [class.on]="tab() === 'library'" (click)="setTab('library')">Kho chung</button>
      </div>
      <div class="upload">
        <label class="btn">
          {{ uploading() ? 'Đang tải lên...' : '+ Thêm nhạc' }}
          <input type="file" multiple hidden [disabled]="uploading()"
                 accept=".mp3,.m4a,.ogg,.wav,.flac" (change)="onFiles($event)" />
        </label>
        <span class="hint">mp3, m4a, ogg, wav, flac · tối đa 30 MB mỗi bài</span>
      </div>

            <div class="import">
       <input type="text" placeholder="Dán link YouTube hoặc gõ tên bài..."
       [value]="link()" (input)="link.set($any($event.target).value)"
       (keydown.enter)="startImport()" [disabled]="importing() || searching()" />
           <button (click)="startImport()" [disabled]="importing() || searching() || !link().trim()">
       {{ importing() ? 'Đang gửi...' : searching() ? 'Đang tìm...' : 'Tìm / Nhập' }}
     </button>
      </div>
      @if (importError()) {
        <div class="error">{{ importError() }}</div>
      }
              @if (results().length > 0) {
        <div class="results">
          @for (r of results(); track r.videoId) {
            <div class="res">
              <span class="meta">
                <span class="title">{{ r.title }}</span>
                <span class="artist">{{ r.channel || 'Không rõ kênh' }}</span>
              </span>
              <span class="dur">{{ fmt(r.durationSeconds) }}</span>
              <button (click)="pick(r)" [disabled]="importing()">+ Nhập</button>
            </div>
          }
          <button class="close" (click)="results.set([])">Đóng</button>
        </div>
      } @else if (searched()) {
        <div class="imp">Không tìm thấy bài phù hợp (bài quá 15 phút hoặc video trực tiếp bị loại).</div>
      }
      @for (i of imports(); track i.id) {
        <div class="imp" [class.failed]="i.status === 'failed'">
          <span class="imp-title">{{ i.title || i.url }}</span>
          @if (i.status === 'failed') {
            <span class="imp-msg">{{ i.error }}</span>
            <button (click)="dismissImport(i)">Bỏ</button>
          } @else {
            <span class="imp-msg">{{ i.status === 'queued' ? 'Đang chờ...' : 'Đang tải và chuyển sang mp3...' }}</span>
          }
        </div>
      }

      @for (e of errors(); track $index) {
        <div class="error">{{ e }}</div>
      }

           @if (tab() === 'mine') {
        @if (loading()) {
          <p>Đang tải...</p>
        } @else if (tracks().length === 0) {
          <p>Chưa có bài nào. Bấm "Thêm nhạc" hoặc sang tab "Kho chung" để thêm bài vào danh sách.</p>
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
                <button class="del" (click)="remove(t)" title="Bỏ khỏi danh sách">🗑</button>
              </li>
            }
          </ul>
        }
      } @else {
        <div class="search">
          <input type="search" placeholder="Tìm theo tên bài hoặc nghệ sĩ..."
                 [value]="libQuery()" (input)="libQuery.set($any($event.target).value)"
                 (keydown.enter)="loadLibrary(1)" />
          <button (click)="loadLibrary(1)">Tìm</button>
        </div>
        @if (libLoading()) {
          <p>Đang tải...</p>
        } @else if (libTracks().length === 0) {
          <p>Không có bài nào trong kho.</p>
        } @else {
          @for (t of libTracks(); track t.id) {
            <div class="lrow">
              <span class="meta">
                <span class="title">{{ t.title }}@if (t.origin === 'Youtube') {<span class="tag">YouTube</span>}</span>
                <span class="artist">{{ t.artist || 'Không rõ nghệ sĩ' }} · đăng bởi {{ t.uploaderName || '?' }}</span>
              </span>
              <span class="dur">{{ fmt(t.durationSeconds) }}</span>
              <span class="size">{{ mb(t.sizeBytes) }} MB</span>
              <button class="add" [disabled]="t.inLibrary" (click)="addToMine(t)">
                {{ t.inLibrary ? '✓ Đã thêm' : '+ Thêm vào danh sách' }}
              </button>
            </div>
          }
          <div class="paging">
            <button [disabled]="libPage() <= 1" (click)="loadLibrary(libPage() - 1)">‹ Trước</button>
            <span>Trang {{ libPage() }} / {{ libPages() }} ({{ libTotal() }} bài)</span>
            <button [disabled]="libPage() >= libPages()" (click)="loadLibrary(libPage() + 1)">Sau ›</button>
          </div>
        }
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
        .import { display: flex; gap: 8px; margin: 8px 0; }
    .import input { flex: 1; padding: 8px 10px; border: 1px solid #ccd; border-radius: 8px; font: inherit; }
    .import button { padding: 8px 14px; border: none; border-radius: 8px; background: #4f7cff; color: #fff; cursor: pointer; }
    .import button:disabled { opacity: .5; cursor: default; }
    .imp { display: flex; align-items: center; gap: 10px; background: #f3f6ff; padding: 6px 10px; border-radius: 6px; margin: 4px 0; font-size: 13px; }
    .imp.failed { background: #fdecec; color: #b3261e; }
    .imp-title { font-weight: 600; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .imp-msg { flex: 1; color: #555; }
    .imp.failed .imp-msg { color: inherit; }
    .imp button { padding: 2px 10px; border: 1px solid #ccd; border-radius: 6px; background: #fff; cursor: pointer; }
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
    .results { background: #f3f6ff; border-radius: 8px; padding: 6px 10px; margin: 6px 0; }
    .res { display: grid; grid-template-columns: 1fr 56px 80px; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #e3e6ec; }
    .res button { padding: 4px 10px; border: 1px solid #4f7cff; border-radius: 6px; background: #fff; color: #4f7cff; cursor: pointer; }
    .res button:disabled { opacity: .5; cursor: default; }
    .results .close { margin-top: 6px; padding: 2px 10px; border: 1px solid #ccd; border-radius: 6px; background: #fff; cursor: pointer; }
    .tabs { display: flex; gap: 8px; margin: 12px 0; }
    .tabs button { padding: 6px 14px; border: 1px solid #ccd; border-radius: 8px; background: #fff; cursor: pointer; font: inherit; }
    .tabs button.on { background: #4f7cff; color: #fff; border-color: #4f7cff; }
    .search { display: flex; gap: 8px; margin: 8px 0; }
    .search input { flex: 1; padding: 8px 10px; border: 1px solid #ccd; border-radius: 8px; font: inherit; }
    .search button { padding: 8px 14px; border: none; border-radius: 8px; background: #4f7cff; color: #fff; cursor: pointer; }
    .lrow { display: grid; grid-template-columns: 1fr 56px 72px 150px; align-items: center; gap: 8px; padding: 8px 6px; border-bottom: 1px solid #eee; }
    .lrow .add { padding: 4px 10px; border: 1px solid #4f7cff; border-radius: 6px; background: #fff; color: #4f7cff; cursor: pointer; }
    .lrow .add:disabled { border-color: #ccd; color: #777; cursor: default; }
    .tag { font-size: 10px; background: #eee; border-radius: 4px; padding: 1px 5px; margin-left: 6px; color: #555; }
    .paging { display: flex; align-items: center; justify-content: center; gap: 12px; margin: 12px 0; font-size: 13px; }
    .paging button { padding: 4px 12px; border: 1px solid #ccd; border-radius: 6px; background: #fff; cursor: pointer; }
    .paging button:disabled { opacity: .5; cursor: default; }
    `,
})
export class MusicPage implements OnInit, OnDestroy {
  private api = inject(MusicApiService);
  private auth = inject(AuthService);
  protected player = inject(PlayerService);
  private importApi = inject(ImportApiService);
  protected link = signal('');
  protected importing = signal(false);
  protected importError = signal('');
  protected results = signal<SearchResult[]>([]);
  protected searching = signal(false);
  protected searched = signal(false);   // đã tìm xong (để hiện "không tìm thấy" khi không có kết quả)
  protected imports = signal<ImportDto[]>([]);
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  protected tracks = signal<TrackDto[]>([]);
  protected used = signal(0);
  protected quota = signal(0);
  protected loading = signal(true);
  protected uploading = signal(false);
  protected errors = signal<string[]>([]);
  protected tab = signal<'mine' | 'library'>('mine');
  protected libTracks = signal<TrackDto[]>([]);
  protected libTotal = signal(0);
  protected libPage = signal(1);
  protected libPageSize = signal(30);
  protected libQuery = signal('');
  protected libLoading = signal(false);
  protected libPages = computed(() =>
    Math.max(1, Math.ceil(this.libTotal() / this.libPageSize())));
  protected usedPercent = computed(() =>
    this.quota() > 0 ? Math.min(100, (this.used() / this.quota()) * 100) : 0);

  ngOnInit(): void {
    this.reload();
        this.loadImports();
  }

  private reload(): void {
    this.api.list().subscribe({
      next: r => {
        this.tracks.set(r.tracks);
        this.used.set(r.usedBytes);
        this.quota.set(r.quotaBytes);
        if (this.tab() === 'library') this.loadLibrary(this.libPage());
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

     protected startImport(): void {
    const text = this.link().trim();
    if (!text || this.importing() || this.searching()) return;

    if (/^https?:\/\//i.test(text)) this.sendImport(text);
    else this.search(text);
  }

  // Tìm theo tên: hiện tối đa 5 kết quả để chọn
  private search(q: string): void {
    if (q.length < 2) {
      this.importError.set('Gõ ít nhất 2 ký tự để tìm.');
      return;
    }
    this.searching.set(true);
    this.searched.set(false);
    this.importError.set('');
    this.results.set([]);
    this.api.search(q).subscribe({
      next: r => {
        this.results.set(r);
        this.searched.set(true);
        this.searching.set(false);
      },
      error: e => {
        this.searching.set(false);
        this.importError.set(this.msg(e, 'Không tìm được bài.'));
      },
    });
  }

  // Chọn một kết quả tìm kiếm để nhập
  protected pick(r: SearchResult): void {
    if (this.importing()) return;
    this.sendImport(`https://www.youtube.com/watch?v=${r.videoId}`);
  }

  private sendImport(url: string): void {
    this.importing.set(true);
    this.importError.set('');
    this.importApi.start(url).subscribe({
      next: imp => {
        this.importing.set(false);
        this.link.set('');
        this.results.set([]);
        this.searched.set(false);
        this.imports.update(list => [imp, ...list]);
        this.startPolling();
      },
      error: e => {
        this.importing.set(false);
        this.importError.set(this.msg(e, 'Không gửi được link.'));
      },
    });
  }

  protected dismissImport(i: ImportDto): void {
    this.importApi.dismiss(i.id).subscribe({
      next: () => this.imports.update(list => list.filter(x => x.id !== i.id)),
      error: e => this.importError.set(this.msg(e, 'Không bỏ được mục này.')),
    });
  }

  private loadImports(): void {
    this.importApi.list().subscribe({
      next: rows => this.applyImports(rows),
      error: () => { /* bỏ qua, lần hỏi sau sẽ thử lại */ },
    });
  }

  private applyImports(rows: ImportDto[]): void {
    const ids = new Set(rows.map(r => r.id));
    // có lần nhập vừa xong (biến mất khỏi danh sách) thì tải lại thư viện để thấy bài mới
    const finished = this.imports().some(i => i.status !== 'failed' && !ids.has(i.id));
    this.imports.set(rows);
    if (finished) this.reload();

    if (rows.some(r => r.status !== 'failed')) this.startPolling();
    else this.stopPolling();
  }

  // trong lúc còn bài đang nhập thì cứ 3 giây hỏi server một lần
  private startPolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => this.loadImports(), 3000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

    protected setTab(t: 'mine' | 'library'): void {
    this.tab.set(t);
    if (t === 'library') this.loadLibrary(1);
  }

  protected loadLibrary(page: number): void {
    this.libLoading.set(true);
    this.api.library(this.libQuery().trim(), page).subscribe({
      next: r => {
        this.libTracks.set(r.tracks);
        this.libTotal.set(r.total);
        this.libPage.set(r.page);
        this.libPageSize.set(r.pageSize);
        this.libLoading.set(false);
      },
      error: e => {
        this.libLoading.set(false);
        this.errors.set([this.msg(e, 'Không tải được kho nhạc chung.')]);
      },
    });
  }

  protected addToMine(t: TrackDto): void {
    this.api.addToMine(t.id).subscribe({
      next: () => this.reload(),   // tải lại danh sách của mình (và kho nếu đang ở tab kho)
      error: e => this.errors.set([this.msg(e, 'Không thêm được bài.')]),
    });
  }

  protected size(bytes: number): string {
    return bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${this.mb(bytes)} MB`;
  }

  protected remove(t: TrackDto): void {
        if (!confirm(`Bỏ "${t.title}" khỏi danh sách của bạn?`)) return;
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