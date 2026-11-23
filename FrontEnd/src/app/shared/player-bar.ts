import { Component, effect, inject, ElementRef, ViewChild, viewChild } from '@angular/core';
import { PlayerService, RepeatMode } from '../core/player.service';
import { PlayerThemeService } from '../core/player-theme.service';


@Component({
  selector: 'app-player-bar',
  template: `
    @if (p.currentTrack(); as t) {
            @let th = theme.effective();
      <div class="bar" [class.expanded]="th.layout === 'expanded'">
                @if (th.showWave) {
          <canvas #wave class="wave"></canvas>
        }
        <div class="info">
          @if (th.showCover && th.coverImage) {
            <div class="cover"></div>
          }
          <div class="text">
            <div class="title">{{ t.title }}</div>
            <div class="artist">{{ p.error() || t.artist || 'Không rõ nghệ sĩ' }}</div>
          </div>
        </div>

               <div class="center">
          <div class="buttons">
            @if (!p.inRoom()) {
              <button (click)="p.toggleShuffle()" [class.on]="p.shuffle()" title="Ngẫu nhiên">🔀</button>
            }
            <button (click)="p.prev()" [disabled]="!p.canControl()" title="Bài trước">⏮</button>
            <button class="play" (click)="p.toggle()"
                    [disabled]="p.loading() || (!p.canControl() && p.isPlaying())">
              {{ p.isPlaying() ? '⏸' : '▶' }}
            </button>
            <button (click)="p.next()" [disabled]="!p.canControl()" title="Bài sau">⏭</button>
            @if (!p.inRoom()) {
              <button (click)="cycleRepeat()" [class.on]="p.repeatMode() !== 'off'" title="Lặp">
                {{ repeatIcon() }}
              </button>
              @if (p.repeatMode() !== 'off') {
                <input class="limit" type="number" min="1" placeholder="∞"
                       [value]="p.repeatLimit() ?? ''" (change)="onLimit($event)"
                       title="Số lần lặp thêm (để trống = vô hạn)" />
                @if (p.repeatLimit() !== null) {
                  <span class="count">{{ p.repeatsDone() }}/{{ p.repeatLimit() }}</span>
                }
              }
            }
          </div>
          <div class="seek">
            <span>{{ fmt(p.currentTime()) }}</span>
            <input type="range" min="0" step="1"
                   [max]="p.duration() || 0" [value]="p.currentTime()"
                   [style.--pct]="pct()"
                   [disabled]="!p.canControl()"
                   (input)="onSeek($event)" (change)="onSeekCommit($event)" />
            <span>{{ fmt(p.duration()) }}</span>
          </div>
        </div>

        <div class="vol">
          🔊
          <input type="range" min="0" max="1" step="0.05"
                 [value]="p.volume()" (input)="onVolume($event)" />
        </div>
      </div>
    }
  `,
  styles: `
    .bar {position: fixed; left: 0; right: 0; bottom: 0; z-index: 1000;height: 72px; box-sizing: border-box; padding: 6px 16px;display: grid; grid-template-columns: 1fr 2fr 1fr; align-items: center; gap: 16px;background: var(--pt-bg, #1f2430); color: var(--pt-text, #fff);border-radius: var(--pt-radius, 0px) var(--pt-radius, 0px) 0 0;box-shadow: 0 -2px 8px rgba(0,0,0,.25);isolation: isolate; overflow: hidden;}
        /* lớp ảnh nền nằm sau chữ và nút; làm mờ chỉ áp lên lớp này */
    .bar::before {
      content: ''; position: absolute; inset: 0; z-index: -1;
      background: var(--pt-bg-image, none) center / cover no-repeat;
      filter: blur(var(--pt-blur, 0px)); transform: scale(1.1);
    }
    /* lớp phủ tối */
    .bar::after {
      content: ''; position: absolute; inset: 0; z-index: -1;
      background: rgba(0, 0, 0, var(--pt-overlay, 0));
    }
    .info { min-width: 0; display: flex; align-items: center; gap: 12px; }
    .wave {position: absolute; inset: 0; width: 100%; height: 100%;z-index: -1; pointer-events: none; opacity: .35;}
    .text { min-width: 0; }
    .cover {
      flex: none; width: 48px; height: 48px;
      background: var(--pt-cover-image, none) center / cover no-repeat;
      border-radius: var(--pt-cover-radius, 8px);
    }
    .bar.expanded { height: 128px; padding: 12px 20px; }
    .bar.expanded .cover { width: 104px; height: 104px; }
    .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .artist { font-size: 12px; opacity: .7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .center { display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .buttons { display: flex; align-items: center; gap: 6px; }
    .buttons button {
      background: none; border: none; color: inherit; font-size: 18px;
      cursor: pointer; padding: 2px 8px; border-radius: 6px; opacity: .7;
    }
    .buttons button.on { opacity: 1; background: color-mix(in srgb, var(--pt-accent, #3b6df0) 30%, transparent); }
    .buttons button.play { font-size: 22px; opacity: 1; }
    .buttons button[disabled] { opacity: .3; cursor: default; }
    .seek input[disabled] { opacity: .5; }
        .limit {
      width: 44px; height: 24px; box-sizing: border-box; padding: 0 6px;
      font: inherit; font-size: 12px; text-align: center; color: inherit;
      background: color-mix(in srgb, currentColor 12%, transparent);
      border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
      border-radius: 6px; outline: none; -moz-appearance: textfield;
    }
    .limit:focus { border-color: var(--pt-accent, #3b6df0); }
    .limit::placeholder { color: inherit; opacity: .6; }
    .limit::-webkit-inner-spin-button, .limit::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
    .count { font-size: 12px; opacity: .8; }
    .seek { display: flex; align-items: center; gap: 8px; width: 100%; font-size: 12px; }
      .seek input {
      flex: 1; -webkit-appearance: none; appearance: none;
      height: var(--pt-progress-h, 4px); border-radius: 999px; outline: none; color: inherit;
      background: linear-gradient(to right, 
        var(--pt-accent, #3b6df0) var(--pct, 0%),
        color-mix(in srgb, currentColor 25%, transparent) var(--pct, 0%));
    }
    .seek input::-webkit-slider-thumb {
      -webkit-appearance: none; appearance: none;
      width: 12px; height: 12px; border-radius: 50%; border: 0;
      background: var(--pt-accent, #3b6df0);
    }
    .seek input::-moz-range-thumb {
      width: 12px; height: 12px; border-radius: 50%; border: 0;
      background: var(--pt-accent, #3b6df0);
    }
    .seek input { flex: 1; }
    .vol input { width: 100px; accent-color: var(--pt-accent, #3b6df0); }
    .vol input { width: 100px; }
    @media (max-width: 700px) {
      .bar { grid-template-columns: 1fr; height: auto; }
      .vol { display: none; }
    }
  `,
})
export class PlayerBar {
  protected p = inject(PlayerService);
  protected theme = inject(PlayerThemeService);
  private wave = viewChild<ElementRef<HTMLCanvasElement>>('wave');
  constructor() {
    // Effect 1: báo chiều cao thanh nhạc cho cả app (0 khi không có bài đang phát)
    effect(() => {
      const on = this.p.currentTrack() !== null;
      const h = this.theme.effective().layout === 'expanded' ? 128 : 72;
      document.documentElement.style.setProperty('--player-h', on ? `${h}px` : '0px');
    });

    // Effect 2: vẽ sóng nhạc, chỉ chạy khi có canvas (showWave bật) và nhạc đang phát
    effect((onCleanup) => {
      const cv = this.wave()?.nativeElement;
      const playing = this.p.isPlaying();
      const color = this.theme.effective().accent;
      if (!cv) return;

      const g = cv.getContext('2d');
      if (!g) return;

      if (!playing) { g.clearRect(0, 0, cv.width, cv.height); return; }

      const analyser = this.p.getAnalyser();
      if (!analyser) return;

      const data = new Uint8Array(analyser.frequencyBinCount);
      const BARS = 48; // các cột tần số cao gần như trống nên chỉ lấy 48/64
      let raf = 0;

      const draw = () => {
        raf = requestAnimationFrame(draw);
        analyser.getByteFrequencyData(data);
        const dpr = window.devicePixelRatio || 1;
        const w = cv.clientWidth, h = cv.clientHeight;
        if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
          cv.width = Math.round(w * dpr);
          cv.height = Math.round(h * dpr);
        }
        g.setTransform(dpr, 0, 0, dpr, 0, 0);
        g.clearRect(0, 0, w, h);
        g.fillStyle = color;

        const slot = w / BARS;
        for (let i = 0; i < BARS; i++) {
          const barH = (data[i] / 255) * h * 0.9;
          g.fillRect(i * slot + 1, h - barH, Math.max(1, slot - 2), barH);
        }
      };
      draw();

      onCleanup(() => cancelAnimationFrame(raf));
    });
  }


  // phần trăm đã phát, dùng để tô màu phần đã chạy của thanh tiến trình
  protected pct(): string {
    const d = this.p.duration();
    return d > 0 ? `${Math.min(100, (this.p.currentTime() / d) * 100)}%` : '0%';
  }

  protected fmt(s: number): string {
    if (!isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  protected repeatIcon(): string {
    return this.p.repeatMode() === 'one' ? '🔂' : '🔁';
  }

  protected cycleRepeat(): void {
    const order: RepeatMode[] = ['off', 'one', 'list'];
    const next = order[(order.indexOf(this.p.repeatMode()) + 1) % order.length];
    this.p.setRepeat(next, this.p.repeatLimit());
  }

  protected onLimit(ev: Event): void {
    const n = parseInt((ev.target as HTMLInputElement).value, 10);
    this.p.setRepeat(this.p.repeatMode(), n >= 1 ? n : null);
  }

    protected onSeek(ev: Event): void {
    if (this.p.inRoom()) return;
    this.p.seek(+(ev.target as HTMLInputElement).value);
  }

  protected onSeekCommit(ev: Event): void {
    if (this.p.inRoom()) this.p.seek(+(ev.target as HTMLInputElement).value);
  }

  protected onVolume(ev: Event): void {
    this.p.setVolume(+(ev.target as HTMLInputElement).value);
  }
}