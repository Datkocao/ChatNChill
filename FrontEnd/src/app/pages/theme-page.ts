import { Component, OnDestroy, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PlayerThemeService } from '../core/player-theme.service';
import { PRESETS, PlayerTheme, BgMode, ProgressStyle, Layout, CoverShape } from '../core/player-theme';
import { firstValueFrom } from 'rxjs';
import {THEME_IMAGE_EXTENSIONS,THEME_IMAGE_MAX_BYTES,ThemeApiService,} from '../core/theme-api.service';

type ColorKey = 'accent' | 'bg' | 'text' | 'grad1' | 'grad2';
type NumKey = 'gradAngle' | 'radius' | 'blur' | 'overlay';
type ImageKey = 'bgImage' | 'coverImage';

@Component({
  selector: 'app-theme-page',
  imports: [RouterLink],
  template: `
    <div class="wrap">
      <div class="top">
        <a routerLink="/music">← Thư viện nhạc</a>
        <h2>Giao diện trình phát</h2>
      </div>

      <!-- Xem trước: dùng đúng biến --pt-* nên giống thanh nhạc thật -->
            <div class="preview" [class.expanded]="theme.theme().layout === 'expanded'">
                <div class="pv-info">
          @if (theme.theme().showCover && theme.theme().coverImage) {
            <div class="pv-cover"></div>
          }
          <div>
            <div class="pv-title">Tên bài hát mẫu</div>
            <div class="pv-artist">Nghệ sĩ mẫu</div>
          </div>
        </div>
        <div class="pv-center">
          <div class="pv-buttons">🔀 ⏮ <b>⏸</b> ⏭ 🔁</div>
          <div class="pv-seek">
            <span>1:05</span>
            <div class="pv-bar"><div class="pv-fill"></div></div>
            <span>3:14</span>
          </div>
        </div>
      </div>
            <div class="savebar">
                <button class="primary" (click)="saveTheme()" [disabled]="!theme.dirty() || theme.saving()">
          {{ theme.saving() ? 'Đang lưu...' : '💾 Lưu giao diện' }}
        </button>
        <button (click)="theme.revert()" [disabled]="!theme.dirty()">Hủy thay đổi</button>
        @if (theme.dirty()) {
          <span class="unsaved">Có thay đổi chưa lưu</span>
        } @else if (justSaved()) {
          <span class="saved">✔ Đã lưu</span>
        }
      </div>

      <h3>Mẫu có sẵn</h3>
      <div class="presets">
        @for (p of presets; track p.id) {
          <button (click)="theme.applyPreset(p.theme)">{{ p.name }}</button>
        }
      </div>

      <h3>Tuỳ chỉnh</h3>
      @let t = theme.theme();
      <div class="grid">
        <label>Màu nhấn
          <input type="color" [value]="t.accent" (input)="setColor('accent', $event)" />
        </label>
        <label>Màu chữ
          <input type="color" [value]="t.text" (input)="setColor('text', $event)" />
        </label>

        <label>Kiểu nền
          <select (change)="setMode($event)">
            <option value="solid" [selected]="t.bgMode === 'solid'">Màu đơn</option>
            <option value="gradient" [selected]="t.bgMode === 'gradient'">Chuyển sắc</option>
            <option value="image" [selected]="t.bgMode === 'image'">Ảnh</option>
          </select>
        </label>

        @if (t.bgMode === 'gradient') {
          <label>Màu đầu
            <input type="color" [value]="t.grad1" (input)="setColor('grad1', $event)" />
          </label>
          <label>Màu cuối
            <input type="color" [value]="t.grad2" (input)="setColor('grad2', $event)" />
          </label>
          <label>Góc chuyển sắc: {{ t.gradAngle }}°
            <input type="range" min="0" max="360" step="5" [value]="t.gradAngle"
                   (input)="setNum('gradAngle', $event)" />
          </label>
        } @else {
          <label>Màu nền
            <input type="color" [value]="t.bg" (input)="setColor('bg', $event)" />
          </label>
        }

                @if (t.bgMode === 'image') {
          <div class="imgbox">
            <span>Ảnh nền</span>
            <div class="imgrow">
              <label class="btn">
                {{ uploading() === 'bgImage' ? 'Đang tải...' : '+ Chọn ảnh nền' }}
                <input type="file" hidden accept=".jpg,.jpeg,.png,.gif,.webp"
                       [disabled]="uploading() !== null" (change)="pickImage('bgImage', $event)" />
              </label>
              @if (t.bgImage) {
                <button (click)="clearImage('bgImage')">Bỏ ảnh</button>
              } @else {
                <span class="hint">Chưa có ảnh, đang dùng màu nền.</span>
              }
            </div>
          </div>
          <label>Làm mờ ảnh: {{ t.blur }}px
            <input type="range" min="0" max="20" step="1" [value]="t.blur"
                   (input)="setNum('blur', $event)" />
          </label>
          <label>Lớp phủ tối: {{ t.overlay }}%
            <input type="range" min="0" max="80" step="1" [value]="t.overlay"
                   (input)="setNum('overlay', $event)" />
          </label>
        }

        <div class="imgbox">
          <span>Ảnh bìa (hiện ở chế độ mở rộng)</span>
          <div class="imgrow">
            <label class="btn">
              {{ uploading() === 'coverImage' ? 'Đang tải...' : '+ Chọn ảnh bìa' }}
              <input type="file" hidden accept=".jpg,.jpeg,.png,.gif,.webp"
                     [disabled]="uploading() !== null" (change)="pickImage('coverImage', $event)" />
            </label>
            @if (t.coverImage) {
              <button (click)="clearImage('coverImage')">Bỏ ảnh</button>
            }
          </div>
        </div>

        <label>Bo góc: {{ t.radius }}px
          <input type="range" min="0" max="24" step="1" [value]="t.radius"
                 (input)="setNum('radius', $event)" />
        </label>

        <label>Thanh tiến trình
          <select (change)="setProgress($event)">
            <option value="thin" [selected]="t.progress === 'thin'">Mảnh</option>
            <option value="thick" [selected]="t.progress === 'thick'">Dày</option>
          </select>
        </label>
                <label>Bố cục thanh nhạc
          <select (change)="setLayout($event)">
            <option value="compact" [selected]="t.layout === 'compact'">Gọn</option>
            <option value="expanded" [selected]="t.layout === 'expanded'">Mở rộng</option>
          </select>
        </label>

        <label>Hình dạng ảnh bìa
          <select (change)="setCoverShape($event)">
            <option value="square" [selected]="t.coverShape === 'square'">Vuông</option>
            <option value="round" [selected]="t.coverShape === 'round'">Tròn</option>
          </select>
        </label>

        <label class="check">
          <input type="checkbox" [checked]="t.showCover" (change)="setShowCover($event)" />
          Hiện ảnh bìa
        </label>
                <label class="check">
          <input type="checkbox" [checked]="t.showWave" (change)="setShowWave($event)" />
          Sóng nhạc (hiệu ứng cột)
        </label>
      </div>


      <h3>Xuất / nhập JSON</h3>
      <div class="actions">
        <button (click)="doExport()">Xuất JSON</button>
        <button (click)="doImport()">Nhập JSON</button>
        <button class="danger" (click)="theme.reset()">Đặt lại mặc định</button>
      </div>
      <textarea rows="10" spellcheck="false"
                placeholder="Bấm Xuất JSON để xem theme hiện tại, hoặc dán JSON vào đây rồi bấm Nhập JSON"
                [value]="json()" (input)="json.set($any($event.target).value)"></textarea>
      @if (message()) {
        <div class="msg" [class.err]="isError()">{{ message() }}</div>
      }
    </div>
  `,
  styles: `
    .wrap { max-width: 760px; margin: 0 auto; padding: 16px 16px calc(24px + var(--player-h, 0px)); }
    .top { display: flex; align-items: center; gap: 16px; }
    .top h2 { margin: 0; }
    h3 { margin: 20px 0 8px; }

    .preview {
      display: grid; grid-template-columns: 1fr 2fr; align-items: center; gap: 16px;
      height: 72px; box-sizing: border-box; padding: 6px 16px; margin-top: 12px;
      background: var(--pt-bg, #1f2430); color: var(--pt-text, #fff);
      border-radius: var(--pt-radius, 0px);
      box-shadow: 0 2px 8px rgba(0,0,0,.25);
      position: relative; isolation: isolate; overflow: hidden;
    }

        /* lớp ảnh nền nằm sau chữ, làm mờ chỉ áp lên lớp này */
    .preview::before {
      content: ''; position: absolute; inset: 0; z-index: -1;
      background: var(--pt-bg-image, none) center / cover no-repeat;
      filter: blur(var(--pt-blur, 0px)); transform: scale(1.1);
    }
    /* lớp phủ tối */
    .preview::after {
      content: ''; position: absolute; inset: 0; z-index: -1;
      background: rgba(0, 0, 0, var(--pt-overlay, 0));
    }
        .pv-info { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .pv-cover {
      flex: none; width: 48px; height: 48px;
      background: var(--pt-cover-image, none) center / cover no-repeat;
      border-radius: var(--pt-cover-radius, 8px);
    }
    .preview.expanded { height: 128px; padding: 12px 20px; }
    .preview.expanded .pv-cover { width: 104px; height: 104px; }
    .grid label.check { flex-direction: row; align-items: center; gap: 6px; }
    .imgbox { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .imgrow { display: flex; align-items: center; gap: 8px; }
    .imgrow .btn { background: #4f7cff; color: #fff; padding: 6px 12px; border-radius: 8px; cursor: pointer; }
    .imgrow button { padding: 6px 12px; border: 1px solid #ccd; border-radius: 8px; background: #fff; cursor: pointer; }
    .hint { font-size: 12px; color: #777; }
    .pv-title { font-weight: 600; }
    .pv-artist { font-size: 12px; opacity: .7; }
    .pv-center { display: flex; flex-direction: column; align-items: center; gap: 4px; }
    .pv-buttons { font-size: 16px; letter-spacing: 6px; }
    .pv-seek { display: flex; align-items: center; gap: 8px; width: 100%; font-size: 12px; }
    .pv-bar {
      flex: 1; height: var(--pt-progress-h, 4px); border-radius: 999px;
      background: color-mix(in srgb, currentColor 25%, transparent);
    }
    .pv-fill { width: 35%; height: 100%; border-radius: 999px; background: var(--pt-accent, #3b6df0); }
    .savebar { display: flex; align-items: center; gap: 8px; margin-top: 10px; }
    .savebar button { padding: 6px 14px; border: 1px solid #ccd; border-radius: 8px; background: #fff; cursor: pointer; }
    .savebar button.primary { background: #4f7cff; border-color: #4f7cff; color: #fff; }
    .savebar button:disabled { opacity: .5; cursor: default; }
    .unsaved { font-size: 13px; color: #b36b00; }
    .saved { font-size: 13px; color: #1b7f3b; }

    .presets, .actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .presets button, .actions button {
      padding: 6px 14px; border: 1px solid #ccd; border-radius: 8px; background: #fff; cursor: pointer;
    }
    .actions button.danger { color: #b3261e; border-color: #e3b5b2; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; }
    .grid label { display: flex; flex-direction: column; gap: 4px; font-size: 13px; }
    .grid input[type=color] { width: 60px; height: 32px; padding: 0; border: 1px solid #ccd; background: none; }
    .note { font-size: 12px; color: #777; }
    textarea { width: 100%; box-sizing: border-box; margin-top: 8px; font-family: monospace; font-size: 12px; }
    .msg { margin-top: 6px; font-size: 13px; color: #1b7f3b; }
    .msg.err { color: #b3261e; }
  `,
})
export class ThemePage implements OnDestroy {
  protected theme = inject(PlayerThemeService);
  protected presets = PRESETS;

  protected json = signal('');
  protected message = signal('');
  protected isError = signal(false);
  protected justSaved = signal(false);

    private api = inject(ThemeApiService);
  protected uploading = signal<ImageKey | null>(null);

  protected async pickImage(key: ImageKey, ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
    if (!THEME_IMAGE_EXTENSIONS.includes(ext)) {
      this.show('Chỉ nhận ảnh jpg, png, gif, webp.', true);
      return;
    }
    if (file.size > THEME_IMAGE_MAX_BYTES) {
      this.show('Ảnh quá lớn (tối đa 5 MB).', true);
      return;
    }

    this.uploading.set(key);
    try {
      const { url } = await firstValueFrom(this.api.upload(file));
      this.theme.update({ [key]: url } as Partial<PlayerTheme>);
      this.show('Đã tải ảnh lên. Nhớ bấm "Lưu giao diện" để giữ lại.', false);
    } catch (e: any) {
      this.show(e?.error?.message ?? 'Tải ảnh thất bại.', true);
    } finally {
      this.uploading.set(null);
    }
  }

  protected clearImage(key: ImageKey): void {
    this.theme.update({ [key]: null } as Partial<PlayerTheme>);
  }

    protected async saveTheme(): Promise<void> {
    const error = await this.theme.save();
    if (error) {
      this.justSaved.set(false);
      this.show(error, true);
    } else {
      this.justSaved.set(true);
      this.message.set(''); // xoá dòng nhắc "nhớ bấm Lưu" cũ
    }
  }

  // rời trang mà chưa lưu thì bỏ phần đang xem thử
  ngOnDestroy(): void {
    this.theme.revert();
  }

  protected setColor(key: ColorKey, ev: Event): void {
    this.theme.update({ [key]: (ev.target as HTMLInputElement).value } as Partial<PlayerTheme>);
  }

  protected setNum(key: NumKey, ev: Event): void {
    this.theme.update({ [key]: +(ev.target as HTMLInputElement).value } as Partial<PlayerTheme>);
  }

  protected setMode(ev: Event): void {
    this.theme.update({ bgMode: (ev.target as HTMLSelectElement).value as BgMode });
  }

  protected setProgress(ev: Event): void {
    this.theme.update({ progress: (ev.target as HTMLSelectElement).value as ProgressStyle });
  }
    protected setLayout(ev: Event): void {
    this.theme.update({ layout: (ev.target as HTMLSelectElement).value as Layout });
  }

  protected setCoverShape(ev: Event): void {
    this.theme.update({ coverShape: (ev.target as HTMLSelectElement).value as CoverShape });
  }

  protected setShowCover(ev: Event): void {
    this.theme.update({ showCover: (ev.target as HTMLInputElement).checked });
  }

    protected setShowWave(ev: Event): void {
    this.theme.update({ showWave: (ev.target as HTMLInputElement).checked });
  }

  protected doExport(): void {
    this.json.set(this.theme.exportJson());
    this.show('Đã xuất theme hiện tại.', false);
  }

  protected doImport(): void {
    const ok = this.theme.importJson(this.json());
    this.show(ok ? 'Đã nhập theme.' : 'JSON không hợp lệ.', !ok);
  }

  private show(text: string, error: boolean): void {
    this.message.set(text);
    this.isError.set(error);
  }
}