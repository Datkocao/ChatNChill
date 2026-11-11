import { HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-auth-page',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="wrap">
      <form class="card" (ngSubmit)="submit()">
        <h2>{{ mode() === 'login' ? 'Đăng nhập' : 'Đăng ký' }}</h2>

        <label>
          Tên đăng nhập
          <input name="username" [(ngModel)]="username" autocomplete="username" />
        </label>

        @if (mode() === 'register') {
          <label>
            Tên hiển thị
            <input name="displayName" [(ngModel)]="displayName" />
          </label>
        }

        <label>
          Mật khẩu
          <input
            name="password"
            type="password"
            [(ngModel)]="password"
            [attr.autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
          />
        </label>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }

        <button type="submit" [disabled]="loading()">
          {{ loading() ? 'Đang xử lý...' : mode() === 'login' ? 'Đăng nhập' : 'Tạo tài khoản' }}
        </button>

        <button type="button" class="link" (click)="toggle()">
          {{ mode() === 'login' ? 'Chưa có tài khoản? Đăng ký' : 'Đã có tài khoản? Đăng nhập' }}
        </button>
      </form>
    </div>
  `,
  styles: [
    `
      .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f2f4f8; }
      .card { width: 340px; background: #fff; padding: 24px; border-radius: 12px; box-shadow: 0 4px 20px rgba(0,0,0,.08); display: flex; flex-direction: column; gap: 14px; }
      h2 { margin: 0 0 4px; }
      label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; }
      input { padding: 10px; border: 1px solid #cfd6e0; border-radius: 8px; font-size: 15px; }
      button { padding: 10px; border: 0; border-radius: 8px; background: #3b6df0; color: #fff; font-size: 15px; cursor: pointer; }
      button[disabled] { opacity: .6; cursor: default; }
      button.link { background: none; color: #3b6df0; padding: 0; font-size: 14px; }
      .error { color: #c62828; margin: 0; font-size: 14px; }
    `,
  ],
})
export class AuthPage {
  private auth = inject(AuthService);
  private router = inject(Router);

  username = '';
  password = '';
  displayName = '';

  mode = signal<'login' | 'register'>('login');
  loading = signal(false);
  error = signal('');

  toggle(): void {
    this.mode.update(m => (m === 'login' ? 'register' : 'login'));
    this.error.set('');
  }

  submit(): void {
    if (this.loading()) return;

    const username = this.username.trim();
    if (!username || !this.password) {
      this.error.set('Vui lòng nhập đủ thông tin.');
      return;
    }

    this.loading.set(true);
    this.error.set('');

    const request$ =
      this.mode() === 'login'
        ? this.auth.login(username, this.password)
        : this.auth.register(username, this.password, this.displayName.trim());

    request$.subscribe({
      next: () => {
        this.loading.set(false);
        this.router.navigateByUrl('/chat');
      },
      error: (err: HttpErrorResponse) => {
        this.loading.set(false);
        this.error.set(this.toMessage(err));
      },
    });
  }

  private toMessage(err: HttpErrorResponse): string {
    if (err.status === 0) return 'Không kết nối được máy chủ. Backend đã chạy chưa?';
    if (err.status === 400) return 'Dữ liệu chưa hợp lệ (tên đăng nhập 3-30 ký tự, mật khẩu từ 6 ký tự).';
    return err.error?.message ?? 'Có lỗi xảy ra, thử lại sau.';
  }
}