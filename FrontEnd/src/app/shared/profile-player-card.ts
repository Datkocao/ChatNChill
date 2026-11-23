import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { API_URL } from '../core/config';
import { PlayerTheme } from '../core/player-theme';
import { PlayerThemeService } from '../core/player-theme.service';

@Component({
  selector: 'app-profile-player-card',
  standalone: true,
  template: `
    @if (th(); as t) {
      <div class="card" [class.expanded]="t.layout === 'expanded'" [style]="vars()">
        @if (t.showCover && t.coverImage) {
          <div class="cover"></div>
        }
        <div class="body">
          <div class="title">Tên bài hát mẫu</div>
          <div class="artist">Nghệ sĩ mẫu</div>
          <div class="buttons">
            <span>⏮</span>
            <span class="play">▶</span>
            <span>⏭</span>
          </div>
          <div class="seek">
            <span>1:12</span>
            <div class="track"><div class="fill"></div></div>
            <span>3:25</span>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    :host { display: block; }
    .card {
      position: relative; isolation: isolate; overflow: hidden;
      display: flex; align-items: center; gap: 16px;
      box-sizing: border-box; max-width: 720px; padding: 16px 20px;
      background: var(--pt-bg); color: var(--pt-text);
      border-radius: var(--pt-radius);
      box-shadow: 0 1px 4px rgba(0,0,0,.15);
      pointer-events: none; user-select: none;
    }
    .card::before {
      content: ''; position: absolute; inset: 0; z-index: -1;
      background: var(--pt-bg-image) center / cover no-repeat;
      filter: blur(var(--pt-blur)); transform: scale(1.1);
    }
    .card::after {
      content: ''; position: absolute; inset: 0; z-index: -1;
      background: rgba(0, 0, 0, var(--pt-overlay));
    }
    .cover {
      flex: none; width: 64px; height: 64px;
      background: var(--pt-cover-image) center / cover no-repeat;
      border-radius: var(--pt-cover-radius);
    }
    .card.expanded { padding: 24px; }
    .card.expanded .cover { width: 128px; height: 128px; }
    .body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .title { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .artist { font-size: 12px; opacity: .7; }
    .buttons { display: flex; align-items: center; gap: 14px; font-size: 18px; opacity: .8; }
    .buttons .play { font-size: 22px; opacity: 1; }
    .seek { display: flex; align-items: center; gap: 8px; font-size: 12px; }
    .track {
      flex: 1; height: var(--pt-progress-h); border-radius: 999px;
      background: color-mix(in srgb, currentColor 25%, transparent);
    }
    .fill { width: 35%; height: 100%; border-radius: 999px; background: var(--pt-accent); }
  `,
})
export class ProfilePlayerCard {
  private themes = inject(PlayerThemeService);

  /** id chủ trang; null = chính mình */
  readonly userId = input<number | null>(null);

  // theme của người khác, null khi chưa tải xong
  private other = signal<PlayerTheme | null>(null);

  protected th = computed<PlayerTheme | null>(() =>
    this.userId() === null ? this.themes.theme() : this.other(),
  );

 protected vars = computed((): Record<string, string> => {
    const t = this.th();
    if (!t) return {};
    const img = (p: string | null) => (p ? `url("${API_URL}${p}")` : 'none');
    return {
      '--pt-accent': t.accent,
      '--pt-text': t.text,
      '--pt-bg': t.bgMode === 'gradient'
        ? `linear-gradient(${t.gradAngle}deg, ${t.grad1}, ${t.grad2})`
        : t.bg,
      '--pt-bg-image': t.bgMode === 'image' ? img(t.bgImage) : 'none',
      '--pt-cover-image': img(t.coverImage),
      '--pt-radius': `${t.radius}px`,
      '--pt-blur': `${t.blur}px`,
      '--pt-overlay': String(t.overlay / 100),
      '--pt-progress-h': t.progress === 'thick' ? '8px' : '4px',
      '--pt-cover-radius': t.coverShape === 'round' ? '50%' : '8px',
    };
  });

  constructor() {
    effect((onCleanup) => {
      const id = this.userId();
      let stale = false;
      onCleanup(() => (stale = true)); // đổi người xem giữa chừng thì bỏ kết quả cũ
      untracked(() => {
        this.other.set(null);
        if (id !== null) {
          void this.themes.fetchOf(id).then(t => {
            if (!stale) this.other.set(t);
          });
        }
      });
    });
  }
}