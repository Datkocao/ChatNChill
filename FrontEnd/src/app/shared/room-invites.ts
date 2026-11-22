import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { RoomService } from '../core/room.service';

@Component({
  selector: 'app-room-invites',
  template: `
    @for (i of rooms.invites(); track i.roomId) {
      <div class="inv">
        <div><b>{{ i.inviterName }}</b> mời bạn vào phòng nghe nhạc <b>{{ i.roomName }}</b></div>
        <div class="acts">
          <button type="button" class="ok" (click)="accept(i.roomId)">Tham gia</button>
          <button type="button" (click)="rooms.dismissInvite(i.roomId)">Bỏ qua</button>
        </div>
      </div>
    }
  `,
  styles: `
    :host { position: fixed; top: 12px; right: 12px; z-index: 2000; display: flex; flex-direction: column; gap: 8px; max-width: 320px; }
    .inv { background: #fff; color: #1f2430; border: 1px solid #cfd6e0; border-radius: 10px; padding: 10px 12px; box-shadow: 0 4px 14px rgba(0,0,0,.18); font-size: 14px; }
    .acts { display: flex; gap: 8px; margin-top: 8px; }
    button { border: 1px solid #cfd6e0; background: #fff; border-radius: 8px; padding: 5px 12px; cursor: pointer; }
    button.ok { background: #3b6df0; border-color: #3b6df0; color: #fff; }
  `,
})
export class RoomInvites {
  protected rooms = inject(RoomService);
  private router = inject(Router);

  protected async accept(roomId: string): Promise<void> {
    await this.rooms.join(roomId);
    void this.router.navigateByUrl('/rooms');   // có lỗi thì trang phòng sẽ hiện thông báo
  }
}