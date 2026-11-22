import { Component, effect, inject, signal, untracked } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { PlayerBar } from './shared/player-bar';
import { RoomInvites } from './shared/room-invites';
import { AuthService } from './core/auth.service';
import { ChatHubService } from './core/chat-hub.service';
import { RoomService } from './core/room.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, PlayerBar, RoomInvites],
  templateUrl: './app.html',
  styleUrl: './app.css'
})
export class App {
  protected readonly title = signal('chat-web');
  private auth = inject(AuthService);
  private hub = inject(ChatHubService);
  private rooms = inject(RoomService);   // tạo sớm để nhận lời mời ở bất kỳ trang nào

  constructor() {
    // Hub sống suốt phiên đăng nhập, không phụ thuộc trang đang mở
    effect(() => {
      const loggedIn = !!this.auth.user();
      untracked(() => {
        if (loggedIn) this.hub.start().catch(() => { /* trang chat sẽ báo lỗi kết nối */ });
        else void this.hub.stop();
      });
    });
  }
}