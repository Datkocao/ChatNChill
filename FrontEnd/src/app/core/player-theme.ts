export const BG_MODES = ['solid', 'gradient', 'image'] as const;
export const LAYOUTS = ['compact', 'expanded'] as const;
export const COVER_SHAPES = ['square', 'round'] as const;
export const PROGRESS_STYLES = ['thin', 'thick'] as const;

export type BgMode = (typeof BG_MODES)[number];
export type Layout = (typeof LAYOUTS)[number];
export type CoverShape = (typeof COVER_SHAPES)[number];
export type ProgressStyle = (typeof PROGRESS_STYLES)[number];

export interface PlayerTheme {
  accent: string;          // màu nhấn: nút, thanh tiến trình
  bg: string;              // màu nền
  text: string;            // màu chữ
  bgMode: BgMode;          // nền: màu đơn / chuyển sắc / ảnh
  grad1: string;           // màu đầu chuyển sắc
  grad2: string;           // màu cuối chuyển sắc
  gradAngle: number;       // 0-360 độ
  bgImage: string | null;  // đường dẫn ảnh nền 
  coverImage: string | null; // đường dẫn ảnh bìa (hiện ở chế độ mở rộng)
  blur: number;            // 0-20 px, làm mờ ảnh nền
  overlay: number;         // 0-80 %, lớp phủ tối lên ảnh nền
  radius: number;          // 0-24 px, bo góc thanh nhạc
  layout: Layout;          // gọn / mở rộng
  showCover: boolean;      // hiện ảnh bìa bài hát
  coverShape: CoverShape;  // bìa vuông / tròn
  progress: ProgressStyle; // thanh tiến trình mảnh / dày
  showWave: boolean;
}

// Giá trị mặc định: sẽ chỉnh lại cho giống giao diện thanh nhạc hiện tại khi nối vào player-bar
export const DEFAULT_THEME: PlayerTheme = {
  accent: '#3b6df0',
  bg: '#1f2430',
  text: '#ffffff',
  bgMode: 'solid',
  grad1: '#3b6df0',
  grad2: '#8aa7f7',
  gradAngle: 135,
  bgImage: null,
coverImage: null,
  blur: 0,
  overlay: 0,
  radius: 0,
  layout: 'compact',
  showCover: true,
  coverShape: 'square',
  progress: 'thin',
  showWave: false,
};

export interface ThemePreset {
  id: string;
  name: string;
  theme: Partial<PlayerTheme>; // chỉ ghi các trường khác mặc định
}

export const PRESETS: ThemePreset[] = [
  { id: 'default', name: 'Mặc định', theme: {} },
  {
    id: 'night',
    name: 'Đêm',
    theme: { bg: '#111827', text: '#f3f4f6', accent: '#8b5cf6' },
  },
  {
    id: 'sunset',
    name: 'Hoàng hôn',
    theme: {
      bgMode: 'gradient', grad1: '#f97316', grad2: '#db2777', gradAngle: 120,
      text: '#ffffff', accent: '#ffffff', radius: 12,
    },
  },
  {
    id: 'ocean',
    name: 'Đại dương',
    theme: {
      bgMode: 'gradient', grad1: '#0ea5e9', grad2: '#1e3a8a', gradAngle: 160,
      text: '#ffffff', accent: '#bae6fd', radius: 12,
    },
  },
  {
    id: 'mint',
    name: 'Bạc hà',
    theme: { bg: '#ecfdf5', text: '#064e3b', accent: '#10b981', radius: 16, coverShape: 'round' },
  },
];

// ---------- Kiểm tra và ép giá trị về đúng khoảng ----------

const HEX = /^#[0-9a-fA-F]{6}$/;
// ảnh chỉ nhận đúng đường dẫn ảnh theme của backend (/api/theme-images/{guid}.đuôi).
// Không nhận link ngoài, để theme nhập từ JSON của người khác không bắt trình duyệt tải ảnh từ máy chủ lạ.
const SAFE_URL = /^\/api\/theme-images\/[0-9a-f]{32}\.(jpg|jpeg|png|gif|webp)$/;
const clamp = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.round(Math.min(max, Math.max(min, v)))
    : fallback;


const color = (v: unknown, fallback: string): string =>
  typeof v === 'string' && HEX.test(v) ? v : fallback;

const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback;

// Nhận bất kỳ dữ liệu nào (localStorage cũ, JSON nhập vào, trường thiếu...) rồi trả về theme hợp lệ
export function sanitizeTheme(raw: unknown): PlayerTheme {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_THEME;
  const image = r['bgImage'];
  const cover = r['coverImage'];
  

  return {
    accent: color(r['accent'], d.accent),
    bg: color(r['bg'], d.bg),
    text: color(r['text'], d.text),
    bgMode: pick(r['bgMode'], BG_MODES, d.bgMode),
    grad1: color(r['grad1'], d.grad1),
    grad2: color(r['grad2'], d.grad2),
    gradAngle: clamp(r['gradAngle'], 0, 360, d.gradAngle),
    bgImage: typeof image === 'string' && SAFE_URL.test(image) ? image : null,
    coverImage: typeof cover === 'string' && SAFE_URL.test(cover) ? cover : null,
    blur: clamp(r['blur'], 0, 20, d.blur),
    overlay: clamp(r['overlay'], 0, 80, d.overlay),
    radius: clamp(r['radius'], 0, 24, d.radius),
    layout: pick(r['layout'], LAYOUTS, d.layout),
    showCover: typeof r['showCover'] === 'boolean' ? r['showCover'] : d.showCover,
    coverShape: pick(r['coverShape'], COVER_SHAPES, d.coverShape),
    progress: pick(r['progress'], PROGRESS_STYLES, d.progress),
    showWave: typeof r['showWave'] === 'boolean' ? r['showWave'] : d.showWave,
  };
}

// Áp preset lên mặc định
export const themeFromPreset = (preset: Partial<PlayerTheme>): PlayerTheme =>
  sanitizeTheme({ ...DEFAULT_THEME, ...preset });