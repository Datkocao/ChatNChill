import { Component, computed, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-chat-page',
  standalone: true,
  template: `
    <div class="bar">
      <span>Xin chào, <b>{{ name() }}</b></span>
      <button (click)="logout()">Đăng xuất</button>
    </div>
    <p class="note">Trang chat sẽ làm ở bước sau.</p>
  `,
  styles: [
    `
      .bar { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; background: #3b6df0; color: #fff; }
      button { padding: 6px 12px; border: 0; border-radius: 6px; cursor: pointer; }
      .note { padding: 16px; }
    `,
  ],
})
export class ChatPage {
  private auth = inject(AuthService);

  name = computed(() => this.auth.user()?.displayName ?? this.auth.user()?.username ?? '');

  logout(): void {
    this.auth.logout();
  }
}