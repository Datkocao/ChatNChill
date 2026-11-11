import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import {
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ChatApiService } from '../core/chat-api.service';
import { ChatHubService } from '../core/chat-hub.service';
import { ConversationDto, MessageDto } from '../core/models';

const PAGE_SIZE = 30;

@Component({
  selector: 'app-chat-page',
  standalone: true,
  imports: [FormsModule, DatePipe],
  template: `
    <div class="app">
      <aside class="side">
        <div class="me">
          <div>
            <b>{{ name() }}</b>
            <small class="status" [attr.data-state]="connection()">{{ statusText() }}</small>
          </div>
          <button type="button" class="ghost" (click)="logout()">Đăng xuất</button>
        </div>

        <form class="new" (ngSubmit)="startChat()">
          <input
            name="newUser"
            placeholder="Nhắn tới (tên đăng nhập)"
            autocomplete="off"
            [ngModel]="newUser()"
            (ngModelChange)="newUser.set($event)"
          />
          <button type="submit">Chat</button>
        </form>

        @if (error()) {
          <p class="error">{{ error() }}</p>
        }

        <div class="list">
          @for (c of conversations(); track c.id) {
            <button
              type="button"
              class="conv"
              [class.active]="c.id === activeId()"
              (click)="open(c.id)"
            >
              <span class="title">{{ c.name }}</span>
              <span class="last">{{ c.lastMessage?.content ?? 'Chưa có tin nhắn' }}</span>
              @if (unread()[c.id]) {
                <span class="badge">{{ unread()[c.id] }}</span>
              }
            </button>
          } @empty {
            <p class="empty">
              Chưa có cuộc trò chuyện nào. Nhập tên đăng nhập của người khác ở trên để bắt đầu.
            </p>
          }
        </div>
      </aside>

      <section class="main">
        @if (active(); as conv) {
          <header>{{ conv.name }}</header>

          <div class="msgs" #scroller>
            @if (hasMore()) {
              <button type="button" class="more" (click)="loadOlder()">Tải tin cũ hơn</button>
            }
            @for (m of messages(); track m.id) {
              <div class="row" [class.mine]="m.senderId === me()?.userId">
                <div class="bubble">
                  @if (m.senderId !== me()?.userId) {
                    <div class="who">{{ m.senderName }}</div>
                  }
                  <div class="text">{{ m.content }}</div>
                  <div class="time">{{ m.createdAt | date: 'HH:mm' }}</div>
                </div>
              </div>
            }
          </div>

          <form class="compose" (ngSubmit)="send()">
            <input
              name="draft"
              placeholder="Nhập tin nhắn..."
              autocomplete="off"
              [ngModel]="draft()"
              (ngModelChange)="draft.set($event)"
            />
            <button type="submit" [disabled]="connection() !== 'connected'">Gửi</button>
          </form>
        } @else {
          <div class="placeholder">Chọn một cuộc trò chuyện hoặc bắt đầu cuộc mới.</div>
        }
      </section>
    </div>
  `,
  styles: [
    `
      :host { display: block; height: 100vh; }
      .app { display: grid; grid-template-columns: 320px 1fr; height: 100%; }

      .side { border-right: 1px solid #e3e7ee; display: flex; flex-direction: column; min-height: 0; background: #fafbfd; }
      .me { display: flex; justify-content: space-between; align-items: center; padding: 12px 14px; background: #3b6df0; color: #fff; }
      .me small { display: block; font-size: 12px; }
      .ghost { background: rgba(255,255,255,.2); color: #fff; border: 0; border-radius: 6px; padding: 6px 10px; cursor: pointer; }

      .status::before { content: '● '; }
      .status[data-state='connected'] { color: #b9f6ca; }
      .status[data-state='connecting'], .status[data-state='reconnecting'] { color: #fff59d; }
      .status[data-state='disconnected'] { color: #ffcdd2; }

      .new { display: flex; gap: 8px; padding: 10px; }
      .new input { flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #cfd6e0; border-radius: 8px; }
      .new button, .compose button { padding: 8px 14px; border: 0; border-radius: 8px; background: #3b6df0; color: #fff; cursor: pointer; }
      button[disabled] { opacity: .5; cursor: default; }
      .error { color: #c62828; margin: 0 12px 8px; font-size: 13px; }

      .list { overflow-y: auto; flex: 1; }
      .conv { position: relative; display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 10px 14px; border: 0; border-bottom: 1px solid #eef1f6; background: transparent; cursor: pointer; }
      .conv:hover { background: #f0f3fa; }
      .conv.active { background: #e4ebfd; }
      .title { font-weight: 600; }
      .last { font-size: 13px; color: #667085; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .badge { position: absolute; right: 12px; top: 12px; background: #e53935; color: #fff; border-radius: 10px; font-size: 12px; padding: 1px 7px; }
      .empty { padding: 14px; color: #667085; font-size: 14px; }

      .main { display: flex; flex-direction: column; min-height: 0; }
      header { padding: 14px 18px; font-weight: 600; border-bottom: 1px solid #e3e7ee; }
      .msgs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; background: #f2f4f8; }
      .more { align-self: center; background: none; border: 0; color: #3b6df0; cursor: pointer; }
      .row { display: flex; }
      .row.mine { justify-content: flex-end; }
      .bubble { max-width: 70%; background: #fff; padding: 8px 12px; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
      .row.mine .bubble { background: #3b6df0; color: #fff; }
      .who { font-size: 12px; color: #667085; margin-bottom: 2px; }
      .text { white-space: pre-wrap; word-break: break-word; }
      .time { font-size: 11px; opacity: .7; text-align: right; margin-top: 2px; }

      .compose { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e3e7ee; }
      .compose input { flex: 1; padding: 10px 12px; border: 1px solid #cfd6e0; border-radius: 8px; font-size: 15px; }
      .placeholder { margin: auto; color: #667085; }
    `,
  ],
})
export class ChatPage implements OnInit, OnDestroy {
  private auth = inject(AuthService);
  private api = inject(ChatApiService);
  private hub = inject(ChatHubService);
  private subs = new Subscription();

  readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');

  me = this.auth.user;
  name = computed(() => this.auth.user()?.displayName ?? this.auth.user()?.username ?? '');

  conversations = signal<ConversationDto[]>([]);
  activeId = signal<number | null>(null);
  messages = signal<MessageDto[]>([]);
  hasMore = signal(false);
  unread = signal<Record<number, number>>({});

  draft = signal('');
  newUser = signal('');
  error = signal('');

  connection = this.hub.state;

  active = computed(() => this.conversations().find(c => c.id === this.activeId()) ?? null);

  statusText = computed(() => {
    switch (this.hub.state()) {
      case 'connected': return 'Đã kết nối';
      case 'connecting': return 'Đang kết nối...';
      case 'reconnecting': return 'Đang kết nối lại...';
      default: return 'Mất kết nối';
    }
  });

  ngOnInit(): void {
    this.loadConversations();

    this.subs.add(this.hub.messages$.subscribe(m => this.onIncoming(m)));
    this.subs.add(this.hub.reconnected$.subscribe(() => this.refresh()));

    this.hub.start().catch(() => this.error.set('Không kết nối được máy chủ chat.'));
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    void this.hub.stop();
  }

  logout(): void {
    this.auth.logout();
  }

  open(id: number): void {
    this.activeId.set(id);
    this.messages.set([]);
    this.hasMore.set(false);
    this.error.set('');
    this.unread.update(u => ({ ...u, [id]: 0 }));

    this.api.messages(id, undefined, PAGE_SIZE).subscribe({
      next: items => {
        if (this.activeId() !== id) return;
        this.messages.set(items);
        this.hasMore.set(items.length >= PAGE_SIZE);
        this.scrollToBottom();
      },
      error: () => this.error.set('Không tải được tin nhắn.'),
    });
  }

  loadOlder(): void {
    const id = this.activeId();
    const first = this.messages()[0];
    if (id === null || !first) return;

    const el = this.scroller()?.nativeElement;
    const oldHeight = el?.scrollHeight ?? 0;

    this.api.messages(id, first.id, PAGE_SIZE).subscribe({
      next: items => {
        if (this.activeId() !== id) return;
        this.messages.update(list => [...items, ...list]);
        this.hasMore.set(items.length >= PAGE_SIZE);

        // giữ nguyên vị trí đang đọc sau khi chèn tin cũ lên trên
        setTimeout(() => {
          const box = this.scroller()?.nativeElement;
          if (box) box.scrollTop = box.scrollHeight - oldHeight;
        });
      },
      error: () => this.error.set('Không tải được tin cũ hơn.'),
    });
  }

  startChat(): void {
    const username = this.newUser().trim();
    if (!username) return;

    this.api.startDirect(username).subscribe({
      next: conv => {
        this.newUser.set('');
        this.error.set('');
        this.conversations.update(list =>
          list.some(c => c.id === conv.id) ? list : [conv, ...list]
        );
        this.open(conv.id);
      },
      error: (err: HttpErrorResponse) =>
        this.error.set(err.error?.message ?? 'Không tạo được cuộc trò chuyện.'),
    });
  }

  async send(): Promise<void> {
    const id = this.activeId();
    const content = this.draft().trim();
    if (id === null || !content) return;

    this.draft.set('');
    try {
      await this.hub.send(id, content);
    } catch {
      this.draft.set(content);
      this.error.set('Không gửi được tin nhắn.');
    }
  }

  private loadConversations(): void {
    this.api.conversations().subscribe({
      next: list => this.conversations.set(list),
      error: () => this.error.set('Không tải được danh sách cuộc trò chuyện.'),
    });
  }

  private refresh(): void {
    this.loadConversations();
    const id = this.activeId();
    if (id !== null) this.open(id);
  }

  private onIncoming(m: MessageDto): void {
    const known = this.conversations().some(c => c.id === m.conversationId);

    if (!known) {
      // cuộc trò chuyện mới do người khác vừa mở với mình
      this.loadConversations();
    } else {
      this.conversations.update(list => {
        const target = list.find(c => c.id === m.conversationId)!;
        return [{ ...target, lastMessage: m }, ...list.filter(c => c.id !== m.conversationId)];
      });
    }

    if (m.conversationId === this.activeId()) {
      this.messages.update(list => (list.some(x => x.id === m.id) ? list : [...list, m]));
      this.scrollToBottom();
    } else if (m.senderId !== this.me()?.userId) {
      this.unread.update(u => ({ ...u, [m.conversationId]: (u[m.conversationId] ?? 0) + 1 }));
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      const el = this.scroller()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }
}