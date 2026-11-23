import { HttpClient } from '@angular/common/http';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { API_URL } from './config';
import { AuthService } from './auth.service';
import {DEFAULT_THEME,PlayerTheme,sanitizeTheme,themeFromPreset,} from './player-theme';

// bản đệm trong trình duyệt; nguồn chính là server
const STORAGE_KEY = 'chatandchill.playerTheme';

@Injectable({ providedIn: 'root' })
export class PlayerThemeService {
  private http = inject(HttpClient);
  private auth = inject(AuthService);

  // bản đã lưu (khớp với server)
  private readonly saved = signal<PlayerTheme>(this.readCache());
  // bản đang chỉnh: áp lên thanh nhạc ngay để xem thử, chưa lưu cho tới khi gọi save()
  readonly theme = signal<PlayerTheme>({ ...this.saved() });
  // true khi có thay đổi chưa lưu
  readonly dirty = computed(
    () => JSON.stringify(this.theme()) !== JSON.stringify(this.saved()),
  );
  readonly saving = signal(false);
    // theme tạm (ví dụ giao diện của chủ phòng); null = dùng theme của mình
  private readonly override = signal<PlayerTheme | null>(null);
  // theme đang hiển thị thật trên thanh nhạc và biến CSS
  readonly effective = computed(() => this.override() ?? this.theme());

  constructor() {
    // mỗi khi theme đổi: chỉ ghi biến CSS lên <html>, không lưu
        effect(() => this.apply(this.effective()));

    // đăng nhập thì tải theme từ server, đăng xuất thì về mặc định
    effect(() => {
      const user = this.auth.user();
      untracked(() => (user ? void this.loadFromServer() : this.resetLocal()));
    });
  }

  update(patch: Partial<PlayerTheme>): void {
    this.theme.update(t => sanitizeTheme({ ...t, ...patch }));
  }

  applyPreset(preset: Partial<PlayerTheme>): void {
    this.theme.set(themeFromPreset(preset));
  }

  reset(): void {
    this.theme.set({ ...DEFAULT_THEME });
  }

  // bỏ các thay đổi chưa lưu
  revert(): void {
    this.theme.set({ ...this.saved() });
  }

  /** Lưu lên server. Trả về null nếu thành công, hoặc thông báo lỗi. */
  async save(): Promise<string | null> {
    if (this.saving()) return null;
    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<{ theme: unknown }>(`${API_URL}/api/player-theme/me`, this.theme()),
      );
      // dùng đúng bản server đã kiểm tra (ví dụ ảnh không hợp lệ đã bị bỏ)
      const t = sanitizeTheme(res.theme);
      this.saved.set(t);
      this.theme.set({ ...t });
      this.writeCache(t);
      return null;
    } catch (e: any) {
      return e?.error?.message ?? 'Không lưu được giao diện. Thử lại sau.';
    } finally {
      this.saving.set(false);
    }
  }

  exportJson(): string {
    return JSON.stringify(this.theme(), null, 2);
  }

  // trả về false nếu chuỗi không phải JSON object hợp lệ
  importJson(text: string): boolean {
    try {
      const raw: unknown = JSON.parse(text);
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
      this.theme.set(sanitizeTheme(raw));
      return true;
    } catch {
      return false;
    }
  }

    /** Đặt theme tạm (null = bỏ theme tạm, quay về theme của mình). Không lưu gì. */
  setOverride(t: PlayerTheme | null): void {
    this.override.set(t ? { ...t } : null);
  }

  /** Lấy theme đã lưu của một người dùng khác; chưa lưu hoặc lỗi thì trả mặc định. */
  async fetchOf(userId: number): Promise<PlayerTheme> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ theme: unknown | null }>(`${API_URL}/api/player-theme/${userId}`),
      );
      return res.theme == null ? { ...DEFAULT_THEME } : sanitizeTheme(res.theme);
    } catch {
      return { ...DEFAULT_THEME };
    }
  }

  // ---------- Server ----------

  private async loadFromServer(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ theme: unknown | null }>(`${API_URL}/api/player-theme/me`),
      );
      if (res.theme == null) return; // chưa từng lưu lên server: giữ bản hiện tại

      const t = sanitizeTheme(res.theme);
      const wasDirty = this.dirty();
      this.saved.set(t);
      if (!wasDirty) this.theme.set({ ...t }); // đang chỉnh dở thì không ghi đè
      this.writeCache(t);
    } catch {
      /* mất mạng hoặc lỗi server: giữ bản đệm */
    }
  }

  private resetLocal(): void {
    this.saved.set({ ...DEFAULT_THEME });
    this.theme.set({ ...DEFAULT_THEME });
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* bỏ qua */
    }
  }

  // ---------- CSS ----------

  private apply(t: PlayerTheme): void {
    const s = document.documentElement.style;
    s.setProperty('--pt-accent', t.accent);
    s.setProperty('--pt-text', t.text);
    s.setProperty('--pt-bg', this.background(t));
    // ảnh nền và ảnh bìa để biến riêng, vì làm mờ và lớp phủ chỉ áp lên lớp ảnh, không áp lên chữ và nút
    s.setProperty('--pt-bg-image', t.bgMode === 'image' && t.bgImage ? `url("${this.abs(t.bgImage)}")` : 'none');
    s.setProperty('--pt-cover-image', t.coverImage ? `url("${this.abs(t.coverImage)}")` : 'none');
    s.setProperty('--pt-radius', `${t.radius}px`);
    s.setProperty('--pt-blur', `${t.blur}px`);
    s.setProperty('--pt-overlay', String(t.overlay / 100));
    s.setProperty('--pt-progress-h', t.progress === 'thick' ? '8px' : '4px');
    s.setProperty('--pt-cover-radius', t.coverShape === 'round' ? '50%' : '8px');
  }

  // màu hoặc chuyển sắc nằm dưới cùng; ở chế độ ảnh thì đây là màu dự phòng khi ảnh chưa tải xong
  private background(t: PlayerTheme): string {
    return t.bgMode === 'gradient'
      ? `linear-gradient(${t.gradAngle}deg, ${t.grad1}, ${t.grad2})`
      : t.bg;
  }

  // đường dẫn của backend là tương đối, cần ghép API_URL (giống ảnh đại diện)
  private abs(path: string): string {
    return API_URL + path;
  }

  // ---------- Bản đệm ----------

  private readCache(): PlayerTheme {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? sanitizeTheme(JSON.parse(raw)) : { ...DEFAULT_THEME };
    } catch {
      return { ...DEFAULT_THEME };
    }
  }

  private writeCache(t: PlayerTheme): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(t));
    } catch {
      /* bỏ qua nếu trình duyệt chặn lưu */
    }
  }
}