import { HttpErrorResponse } from '@angular/common/http';
import {
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { ChatApiService } from '../core/chat-api.service';
import { ChatHubService } from '../core/chat-hub.service';
import { FriendsApiService } from '../core/friends-api.service';
import { ConversationDto, FriendDto, FriendRequestDto, UserSearchDto } from '../core/models';

type Tab = 'friends' | 'requests' | 'find';

const errorText = (err: HttpErrorResponse, fallback: string): string =>
  err.error?.message ??
  (err.status === 403 ? 'Bạn không có quyền thực hiện thao tác này.' : fallback);

@Component({
  selector: 'app-friends-panel',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="fp">
      <div class="tabs">
        <button type="button" [class.on]="tab() === 'friends'" (click)="tab.set('friends')">
          Bạn bè ({{ friends().length }})
        </button>
        <button type="button" [class.on]="tab() === 'requests'" (click)="tab.set('requests')">
          Lời mời
          @if (incoming().length > 0) {
            <span class="badge">{{ incoming().length }}</span>
          }
        </button>
        <button type="button" [class.on]="tab() === 'find'" (click)="tab.set('find')">
          Tìm người
        </button>
      </div>

      @if (error()) {
        <p class="error">{{ error() }}</p>
      }

      <div class="content">
        @switch (tab()) {
          @case ('friends') {
            <button type="button" class="dashed" (click)="toggleGroup()">
              {{ showGroup() ? 'Đóng' : '+ Tạo nhóm' }}
            </button>

            @if (showGroup()) {
              <form class="group" (ngSubmit)="createGroup()">
                <input
                  name="groupName"
                  placeholder="Tên nhóm"
                  autocomplete="off"
                  [ngModel]="groupName()"
                  (ngModelChange)="groupName.set($event)"
                />
                <div class="pick">
                  @for (f of friends(); track f.userId) {
                    <label>
                      <input
                        type="checkbox"
                        [checked]="isSelected(f.userId)"
                        (change)="toggleSelect(f.userId)"
                      />
                      {{ f.displayName }}
                    </label>
                  } @empty {
                    <small>Chưa có bạn bè để chọn.</small>
                  }
                </div>
                @if (groupError()) {
                  <p class="error flat">{{ groupError() }}</p>
                }
                <button type="submit" class="primary">Tạo nhóm ({{ selected().length }})</button>
              </form>
            }

            @for (f of friends(); track f.userId) {
              <div class="item">
                <div class="who">
                  <b>{{ f.displayName }}</b>
                  <small>&#64;{{ f.username }}</small>
                </div>
                <div class="btns">
                  <button type="button" class="primary sm" (click)="startChat(f)">Nhắn tin</button>
                  <button type="button" class="danger sm" (click)="unfriend(f)">Huỷ</button>
                </div>
              </div>
            } @empty {
              <p class="empty">Chưa có bạn bè. Vào tab "Tìm người" để gửi lời mời.</p>
            }
          }

          @case ('requests') {
            @if (incoming().length > 0) {
              <h5>Lời mời đến</h5>
              @for (r of incoming(); track r.id) {
                <div class="item">
                  <div class="who">
                    <b>{{ r.displayName }}</b>
                    <small>&#64;{{ r.username }}</small>
                  </div>
                  <div class="btns">
                    <button type="button" class="primary sm" (click)="accept(r)">Chấp nhận</button>
                    <button type="button" class="danger sm" (click)="decline(r)">Từ chối</button>
                  </div>
                </div>
              }
            }

            @if (outgoing().length > 0) {
              <h5>Đã gửi</h5>
              @for (r of outgoing(); track r.id) {
                <div class="item">
                  <div class="who">
                    <b>{{ r.displayName }}</b>
                    <small>&#64;{{ r.username }}</small>
                  </div>
                  <button type="button" class="danger sm" (click)="decline(r)">Huỷ</button>
                </div>
              }
            }

            @if (requests().length === 0) {
              <p class="empty">Không có lời mời nào.</p>
            }
          }

          @case ('find') {
            <form class="search" (ngSubmit)="search()">
              <input
                name="q"
                placeholder="Tên đăng nhập (ít nhất 2 ký tự)"
                autocomplete="off"
                [ngModel]="query()"
                (ngModelChange)="query.set($event)"
              />
              <button type="submit" class="primary sm">Tìm</button>
            </form>

            @for (u of results(); track u.userId) {
              <div class="item">
                <div class="who">
                  <b>{{ u.displayName }}</b>
                  <small>&#64;{{ u.username }}</small>
                </div>
                @switch (u.relation) {
                  @case ('none') {
                    <button type="button" class="primary sm" (click)="addFriend(u.username)">
                      Kết bạn
                    </button>
                  }
                  @case ('incoming') {
                    <button type="button" class="primary sm" (click)="addFriend(u.username)">
                      Chấp nhận
                    </button>
                  }
                  @case ('outgoing') {
                    <span class="note">Đã gửi lời mời</span>
                  }
                  @case ('friend') {
                    <span class="note">Bạn bè</span>
                  }
                }
              </div>
            } @empty {
              @if (searched()) {
                <p class="empty">Không tìm thấy ai.</p>
              }
            }
          }
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; }
      .fp { border-bottom: 1px solid #e3e7ee; background: #fff; }
      .tabs { display: flex; }
      .tabs button { flex: 1; padding: 9px 4px; border: 0; border-bottom: 2px solid transparent; background: #f5f7fb; cursor: pointer; font-size: 13px; }
      .tabs button.on { background: #fff; border-bottom-color: #3b6df0; color: #3b6df0; font-weight: 600; }
      .badge { background: #e53935; color: #fff; border-radius: 10px; font-size: 11px; padding: 0 6px; margin-left: 4px; }

      .content { max-height: 260px; overflow-y: auto; padding: 8px 10px; display: flex; flex-direction: column; gap: 8px; }
      h5 { margin: 4px 0 0; color: #667085; font-size: 12px; text-transform: uppercase; }
      .item { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .who { display: flex; flex-direction: column; min-width: 0; }
      .who small { color: #667085; }
      .btns { display: flex; gap: 6px; }
      .note { color: #667085; font-size: 12px; }
      .empty { color: #667085; font-size: 13px; margin: 4px 0; }

      .primary { border: 0; border-radius: 8px; background: #3b6df0; color: #fff; cursor: pointer; padding: 8px 14px; }
      .danger { border: 0; border-radius: 8px; background: #fdecea; color: #c62828; cursor: pointer; padding: 8px 14px; }
      .sm { padding: 5px 9px; font-size: 12px; }
      .dashed { padding: 7px; border: 1px dashed #9db4f5; background: transparent; color: #3b6df0; border-radius: 8px; cursor: pointer; }

      .group { display: flex; flex-direction: column; gap: 8px; padding: 8px; border: 1px solid #e3e7ee; border-radius: 10px; }
      .group input[name='groupName'], .search input { padding: 8px 10px; border: 1px solid #cfd6e0; border-radius: 8px; min-width: 0; }
      .pick { display: flex; flex-direction: column; gap: 4px; max-height: 110px; overflow-y: auto; }
      .pick label { display: flex; align-items: center; gap: 6px; font-size: 14px; }
      .search { display: flex; gap: 6px; }
      .search input { flex: 1; }

      .error { color: #c62828; margin: 6px 10px 0; font-size: 13px; }
      .error.flat { margin: 0; }
    `,
  ],
})
export class FriendsPanel implements OnInit, OnDestroy {
  private friendsApi = inject(FriendsApiService);
  private chatApi = inject(ChatApiService);
  private hub = inject(ChatHubService);
  private subs = new Subscription();

  readonly chat = output<string>();
  readonly groupCreated = output<ConversationDto>();

  tab = signal<Tab>('friends');
  error = signal('');

  friends = signal<FriendDto[]>([]);
  requests = signal<FriendRequestDto[]>([]);
  incoming = computed(() => this.requests().filter(r => r.direction === 'incoming'));
  outgoing = computed(() => this.requests().filter(r => r.direction === 'outgoing'));

  query = signal('');
  results = signal<UserSearchDto[]>([]);
  searched = signal(false);

  showGroup = signal(false);
  groupName = signal('');
  selected = signal<number[]>([]);
  groupError = signal('');

  ngOnInit(): void {
    this.reload();
    this.subs.add(this.hub.friendsChanged$.subscribe(() => this.reload()));
    this.subs.add(this.hub.reconnected$.subscribe(() => this.reload()));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
  }

  // ---------- Bạn bè ----------

  startChat(friend: FriendDto): void {
    this.chat.emit(friend.username);
  }

  unfriend(friend: FriendDto): void {
    if (!confirm(`Huỷ kết bạn với ${friend.displayName}?`)) return;

    this.friendsApi.unfriend(friend.userId).subscribe({
      next: () => {
        this.error.set('');
        this.reload();
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(errorText(err, 'Không huỷ kết bạn được.')),
    });
  }

  // ---------- Lời mời ----------

  accept(request: FriendRequestDto): void {
    this.friendsApi.accept(request.id).subscribe({
      next: () => {
        this.error.set('');
        this.reload();
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(errorText(err, 'Không chấp nhận được lời mời.')),
    });
  }

  decline(request: FriendRequestDto): void {
    this.friendsApi.deleteRequest(request.id).subscribe({
      next: () => {
        this.error.set('');
        this.reload();
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(errorText(err, 'Không xử lý được lời mời.')),
    });
  }

  // ---------- Tìm người ----------

  search(): void {
    if (this.query().trim().length < 2) {
      this.error.set('Nhập ít nhất 2 ký tự.');
      return;
    }
    this.error.set('');
    this.runSearch();
  }

  addFriend(username: string): void {
    this.friendsApi.sendRequest(username).subscribe({
      next: () => {
        this.error.set('');
        this.reload();
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(errorText(err, 'Không gửi được lời mời.')),
    });
  }

  // ---------- Tạo nhóm từ bạn bè ----------

  toggleGroup(): void {
    this.showGroup.update(v => !v);
    this.groupError.set('');
  }

  isSelected(userId: number): boolean {
    return this.selected().includes(userId);
  }

  toggleSelect(userId: number): void {
    this.selected.update(list =>
      list.includes(userId) ? list.filter(id => id !== userId) : [...list, userId]
    );
  }

  createGroup(): void {
    const name = this.groupName().trim();
    const usernames = this.friends()
      .filter(f => this.selected().includes(f.userId))
      .map(f => f.username);

    if (!name) {
      this.groupError.set('Nhập tên nhóm.');
      return;
    }
    if (usernames.length < 2) {
      this.groupError.set('Chọn ít nhất 2 người bạn.');
      return;
    }

    this.chatApi.createGroup(name, usernames).subscribe({
      next: conv => {
        this.showGroup.set(false);
        this.groupName.set('');
        this.selected.set([]);
        this.groupError.set('');
        this.groupCreated.emit(conv);
      },
      error: (err: HttpErrorResponse) =>
        this.groupError.set(errorText(err, 'Không tạo được nhóm.')),
    });
  }

  // ---------- Nội bộ ----------

  private reload(): void {
    this.friendsApi.friends().subscribe({
      next: list => {
        this.friends.set(list);
        this.selected.update(ids => ids.filter(id => list.some(f => f.userId === id)));
      },
    });
    this.friendsApi.requests().subscribe({ next: list => this.requests.set(list) });

    if (this.searched() && this.query().trim().length >= 2) {
      this.runSearch();
    }
  }

  private runSearch(): void {
    this.friendsApi.search(this.query().trim()).subscribe({
      next: list => {
        this.results.set(list);
        this.searched.set(true);
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(errorText(err, 'Không tìm được người dùng.')),
    });
  }
}