import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, ElementRef, OnDestroy, OnInit, computed, inject, signal, viewChild, HostListener } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { ChatApiService } from '../core/chat-api.service';
import { ChatHubService, TypingEvent, PresenceEvent, ReadEvent } from '../core/chat-hub.service';
import { ConversationDto, MemberDto, MessageDto } from '../core/models';
import { FriendsPanel } from './friends-panel';
import { API_URL } from '../core/config';

const PAGE_SIZE = 30;
const MAX_UPLOAD = 10 * 1024 * 1024; // 10 MB, khớp với backend
const TYPING_SEND_INTERVAL = 2000; // gửi tín hiệu tối đa 1 lần / 2 giây
const TYPING_EXPIRE = 3000; // ẩn "đang gõ" nếu 3 giây không có tín hiệu mới

const parseNames = (raw: string): string[] =>
    raw
        .split(/[,;\s]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0);

const errorText = (err: HttpErrorResponse, fallback: string): string =>
    err.error?.message ??
    (err.status === 403 ? 'Bạn không có quyền thực hiện thao tác này.' : fallback);

@Component({
    selector: 'app-chat-page',
    standalone: true,
    imports: [FormsModule, DatePipe, FriendsPanel],
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

        <app-friends-panel
          (chat)="newUser.set($event); startChat()"
          (groupCreated)="onGroupCreated($event)"
        />

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
              <span class="title">
                {{ c.name }}
                @if (isOnline(c)) {
                  <span class="dot"></span>
                }
                @if (c.type === 'group') {
                  <span class="tag">Nhóm · {{ c.memberCount }}</span>
                }
              </span>
              <span class="last">{{ lastText(c) }}</span>
              @if (unread()[c.id]) {
                <span class="badge">{{ unread()[c.id] }}</span>
              }
            </button>
          } @empty {
            <p class="empty">
              Chưa có cuộc trò chuyện nào. Nhập tên đăng nhập của người khác ở trên để bắt đầu,
              hoặc tạo nhóm mới.
            </p>
          }
        </div>
      </aside>

      <section class="main">
        @if (active(); as conv) {
          <header>
            <div>
              <div class="h-title">{{ conv.name }}</div>
              @if (conv.type === 'group') {
                <small>{{ conv.memberCount }} thành viên</small>
                } @else if (isOnline(conv)) {
                <small class="online">Đang hoạt động</small>
              }
            </div>
            @if (conv.type === 'group') {
              <button type="button" class="plain" (click)="toggleMembers()">Thành viên</button>
            }
          </header>

          <div class="body">
            <div class="col">
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
                      @if (m.attachmentUrl) {
                        @if (isImage(m)) {
                          <a [href]="fileUrl(m.attachmentUrl)" target="_blank" rel="noopener">
                            <img
                              class="pic"
                              [src]="fileUrl(m.attachmentUrl)"
                              [alt]="m.attachmentName ?? 'Ảnh'"
                              (load)="onImageLoad()"
                            />
                          </a>
                        } @else {
                          <a class="file" [href]="fileUrl(m.attachmentUrl)" target="_blank" rel="noopener" download>
                            <span class="file-name">📎 {{ m.attachmentName }}</span>
                            <small>{{ sizeText(m.attachmentSize) }}</small>
                          </a>
                        }
                      }
                      @if (m.content) {
                        <div class="text">{{ m.content }}</div>
                      }
                      <div class="time">{{ m.createdAt | date: 'HH:mm' }}</div>
                                            @if (seen()?.messageId === m.id) {
                        <div class="seen">{{ seen()!.text }}</div>
                      }
                    </div>
                  </div>
                }
              </div>

               @if (typingText()) {
                <div class="typing">{{ typingText() }}</div>
              }

              <form class="compose" (ngSubmit)="send()">
                                <input
                  #fileInput
                  type="file"
                  hidden
                  accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.zip,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.mp3"
                  (change)="onFilePicked($event)"
                />
                <button
                  type="button"
                  class="attach"
                  title="Đính kèm ảnh/file"
                  [disabled]="uploading() || connection() !== 'connected'"
                  (click)="fileInput.click()"
                >
                  {{ uploading() ? '…' : '📎' }}
                </button>
                <input
                  name="draft"
                  placeholder="Nhập tin nhắn..."
                  autocomplete="off"
                  [ngModel]="draft()"
                  (ngModelChange)="onDraftChange($event)"
                />
                <button type="submit" [disabled]="connection() !== 'connected'">Gửi</button>
              </form>
            </div>

            @if (showMembers() && conv.type === 'group') {
              <aside class="members">
                <h4>Thành viên ({{ members().length }})</h4>

                @if (panelError()) {
                  <p class="error flat">{{ panelError() }}</p>
                }

                <ul>
                  @for (m of members(); track m.userId) {
                    <li>
                      <div>
                        <b>{{ m.displayName }}</b>
                        @if (m.isAdmin) {
                          <span class="tag">Quản trị</span>
                        }
                        <small>&#64;{{ m.username }}</small>
                      </div>
                      @if (conv.isAdmin && !m.isAdmin) {
                        <button type="button" class="danger" (click)="kick(m)">Xoá</button>
                      }
                    </li>
                  }
                </ul>

                @if (conv.isAdmin) {
                  <form (ngSubmit)="addMembers()">
                    <input
                      name="addUsers"
                      placeholder="Thêm: user1, user2"
                      autocomplete="off"
                      [ngModel]="addUsers()"
                      (ngModelChange)="addUsers.set($event)"
                    />
                    <button type="submit" class="primary">Thêm</button>
                  </form>

                  <form (ngSubmit)="rename()">
                    <input
                      name="renameValue"
                      placeholder="Tên nhóm mới"
                      autocomplete="off"
                      [ngModel]="renameValue()"
                      (ngModelChange)="renameValue.set($event)"
                    />
                    <button type="submit" class="primary">Đổi tên</button>
                  </form>
                }

                <button type="button" class="danger" (click)="leave()">Rời nhóm</button>
              </aside>
            }
          </div>
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
      .primary, .compose button { padding: 8px 14px; border: 0; border-radius: 8px; background: #3b6df0; color: #fff; cursor: pointer; }
      button[disabled] { opacity: .5; cursor: default; }
      .sidebtn { margin: 0 10px 8px; padding: 8px; border: 1px dashed #9db4f5; background: transparent; color: #3b6df0; border-radius: 8px; cursor: pointer; }
      .panel { display: flex; flex-direction: column; gap: 8px; padding: 10px; margin: 0 10px 8px; border: 1px solid #e3e7ee; border-radius: 10px; background: #fff; }
      .panel input { padding: 8px 10px; border: 1px solid #cfd6e0; border-radius: 8px; min-width: 0; }
      .error { color: #c62828; margin: 0 12px 8px; font-size: 13px; }
      .error.flat { margin: 0; }

      .list { overflow-y: auto; flex: 1; }
      .conv { position: relative; display: flex; flex-direction: column; gap: 2px; width: 100%; text-align: left; padding: 10px 14px; border: 0; border-bottom: 1px solid #eef1f6; background: transparent; cursor: pointer; }
      .conv:hover { background: #f0f3fa; }
      .conv.active { background: #e4ebfd; }
      .title { font-weight: 600; }
      .last { font-size: 13px; color: #667085; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .badge { position: absolute; right: 12px; top: 12px; background: #e53935; color: #fff; border-radius: 10px; font-size: 12px; padding: 1px 7px; }
      .tag { font-size: 11px; font-weight: 500; background: #e4ebfd; color: #3b6df0; padding: 1px 6px; border-radius: 8px; margin-left: 4px; }
      .dot { display: inline-block; width: 8px; height: 8px; margin-left: 6px; border-radius: 50%; background: #2e7d32; }header small.online { color: #2e7d32; }     
      .empty { padding: 14px; color: #667085; font-size: 14px; }

      .main { display: flex; flex-direction: column; min-height: 0; }
      header { display: flex; justify-content: space-between; align-items: center; padding: 12px 18px; border-bottom: 1px solid #e3e7ee; }
      .h-title { font-weight: 600; }
      header small { color: #667085; }
      .plain { background: none; border: 1px solid #cfd6e0; color: #344054; border-radius: 8px; padding: 6px 12px; cursor: pointer; }

      .body { flex: 1; display: flex; min-height: 0; }
      .col { flex: 1; display: flex; flex-direction: column; min-width: 0; min-height: 0; }
      .msgs { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; background: #f2f4f8; }
      .more { align-self: center; background: none; border: 0; color: #3b6df0; cursor: pointer; }
      .row { display: flex; }
      .row.mine { justify-content: flex-end; }
      .bubble { max-width: 70%; background: #fff; padding: 8px 12px; border-radius: 12px; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
      .row.mine .bubble { background: #3b6df0; color: #fff; }
      .who { font-size: 12px; color: #667085; margin-bottom: 2px; }
      .text { white-space: pre-wrap; word-break: break-word; }
      .time { font-size: 11px; opacity: .7; text-align: right; margin-top: 2px; }
      .seen { font-size: 11px; opacity: .85; text-align: right; }
      .pic { display: block; max-width: 100%; max-height: 300px; border-radius: 8px; margin-bottom: 4px; }
      .file { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; margin-bottom: 4px; border-radius: 8px; background: rgba(0,0,0,.06); color: inherit; text-decoration: none; }
      .file small { opacity: .75; }
      .file-name { word-break: break-all; }
      .compose .attach { background: #eef1f6; color: #344054; }

      .compose { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e3e7ee; }
      .compose input { flex: 1; padding: 10px 12px; border: 1px solid #cfd6e0; border-radius: 8px; font-size: 15px; }
      .typing { padding: 4px 16px; font-size: 12px; color: #667085; font-style: italic; }
      .placeholder { margin: auto; color: #667085; }

      .members { width: 290px; border-left: 1px solid #e3e7ee; padding: 12px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; background: #fff; }
      .members h4 { margin: 0; }
      .members ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
      .members li { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
      .members small { display: block; color: #667085; }
      .members form { display: flex; gap: 6px; }
      .members form input { flex: 1; min-width: 0; padding: 7px 9px; border: 1px solid #cfd6e0; border-radius: 8px; }
      .danger { background: #fdecea; color: #c62828; border: 0; border-radius: 8px; padding: 6px 10px; cursor: pointer; }
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
    onlineIds = signal<Set<number>>(new Set());

    // userId -> id tin cuối mà người đó đã đọc (cuộc trò chuyện đang mở, không gồm mình)
    reads = signal<Record<number, number>>({});
    uploading = signal(false);

    // dòng "Đã xem" hiện dưới tin cuối của mình
    seen = computed(() => {
        const conv = this.active();
        const myId = this.me()?.userId;
        if (!conv || myId == null) return null;

        const lastMine = [...this.messages()].reverse().find(m => m.senderId === myId);
        if (!lastMine) return null;

        const readers = Object.values(this.reads()).filter(id => id >= lastMine.id).length;
        if (readers === 0) return null;

        return {
            messageId: lastMine.id,
            text: conv.type === 'group' ? `Đã xem bởi ${readers} người` : 'Đã xem',
        };
    });
    // ai đang gõ: { [conversationId]: { [userId]: tên } }
    typingUsers = signal<Record<number, Record<number, string>>>({});
    private typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private lastTypingSent = 0;

    typingText = computed(() => {
        const id = this.activeId();
        if (id === null) return '';
        const names = Object.values(this.typingUsers()[id] ?? {});
        if (names.length === 0) return '';
        if (names.length === 1) return `${names[0]} đang gõ...`;
        if (names.length === 2) return `${names[0]} và ${names[1]} đang gõ...`;
        return 'Nhiều người đang gõ...';
    });

    draft = signal('');
    newUser = signal('');
    error = signal('');

    // tạo nhóm
    showCreate = signal(false);
    groupName = signal('');
    groupMembers = signal('');
    groupError = signal('');

    // panel thành viên
    showMembers = signal(false);
    members = signal<MemberDto[]>([]);
    addUsers = signal('');
    renameValue = signal('');
    panelError = signal('');

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
        this.subs.add(this.hub.conversationsChanged$.subscribe(() => this.onConversationsChanged()));
        this.subs.add(this.hub.typing$.subscribe(e => this.onTyping(e)));
        this.subs.add(this.hub.presence$.subscribe(e => this.onPresence(e)));
        this.subs.add(this.hub.reads$.subscribe(e => this.onRead(e)));

        this.hub.start().then(() => this.loadOnline()).catch(() => this.error.set('Không kết nối được máy chủ chat.'));
    }

    ngOnDestroy(): void {
        this.subs.unsubscribe();
        this.typingTimers.forEach(t => clearTimeout(t));
        void this.hub.stop();
    }

    logout(): void {
        this.auth.logout();
    }
    onGroupCreated(conv: ConversationDto): void {
        this.conversations.update(list =>
            list.some(c => c.id === conv.id) ? list : [conv, ...list]
        );
        this.open(conv.id);
    }

    // ---------- Mở cuộc trò chuyện, tin nhắn ----------

    open(id: number): void {
        this.activeId.set(id);
        this.messages.set([]);
        this.reads.set({});
        this.hasMore.set(false);
        this.error.set('');
        this.showMembers.set(false);
        this.panelError.set('');
        this.unread.update(u => ({ ...u, [id]: 0 }));

        this.api.messages(id, undefined, PAGE_SIZE).subscribe({
            next: items => {
                if (this.activeId() !== id) return;
                this.messages.set(items);
                this.hasMore.set(items.length >= PAGE_SIZE);
                this.scrollToBottom();
                this.markLatestRead();
                this.loadReads(id);
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
                this.error.set(errorText(err, 'Không tạo được cuộc trò chuyện.')),
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

    // ---------- Nhóm ----------

    toggleCreate(): void {
        this.showCreate.update(v => !v);
        this.groupError.set('');
    }

    createGroup(): void {
        const name = this.groupName().trim();
        const usernames = parseNames(this.groupMembers());

        if (!name) {
            this.groupError.set('Nhập tên nhóm.');
            return;
        }
        if (usernames.length < 2) {
            this.groupError.set('Nhập ít nhất 2 tên đăng nhập, cách nhau bằng dấu phẩy.');
            return;
        }

        this.api.createGroup(name, usernames).subscribe({
            next: conv => {
                this.showCreate.set(false);
                this.groupName.set('');
                this.groupMembers.set('');
                this.groupError.set('');
                this.conversations.update(list =>
                    list.some(c => c.id === conv.id) ? list : [conv, ...list]
                );
                this.open(conv.id);
            },
            error: (err: HttpErrorResponse) =>
                this.groupError.set(errorText(err, 'Không tạo được nhóm.')),
        });
    }

    toggleMembers(): void {
        const next = !this.showMembers();
        this.showMembers.set(next);
        this.panelError.set('');

        if (next) {
            this.renameValue.set(this.active()?.name ?? '');
            this.loadMembers();
        }
    }

    addMembers(): void {
        const id = this.activeId();
        const usernames = parseNames(this.addUsers());
        if (id === null || usernames.length === 0) return;

        this.api.addMembers(id, usernames).subscribe({
            next: () => {
                this.addUsers.set('');
                this.panelError.set('');
                this.loadMembers();
                this.loadConversations();
            },
            error: (err: HttpErrorResponse) =>
                this.panelError.set(errorText(err, 'Không thêm được thành viên.')),
        });
    }

    kick(member: MemberDto): void {
        const id = this.activeId();
        if (id === null || !confirm(`Xoá ${member.displayName} khỏi nhóm?`)) return;

        this.api.removeMember(id, member.userId).subscribe({
            next: () => {
                this.panelError.set('');
                this.loadMembers();
                this.loadConversations();
            },
            error: (err: HttpErrorResponse) =>
                this.panelError.set(errorText(err, 'Không xoá được thành viên.')),
        });
    }

    rename(): void {
        const id = this.activeId();
        const name = this.renameValue().trim();
        if (id === null || !name) return;

        this.api.rename(id, name).subscribe({
            next: () => {
                this.panelError.set('');
                this.loadConversations();
            },
            error: (err: HttpErrorResponse) =>
                this.panelError.set(errorText(err, 'Không đổi được tên nhóm.')),
        });
    }

    leave(): void {
        const id = this.activeId();
        if (id === null || !confirm('Bạn chắc chắn muốn rời nhóm này?')) return;

        this.api.leave(id).subscribe({
            next: () => {
                this.closeActive();
                this.loadConversations();
            },
            error: (err: HttpErrorResponse) =>
                this.panelError.set(errorText(err, 'Không rời được nhóm.')),
        });
    }

    // ---------- Hàm nội bộ ----------

    private loadMembers(): void {
        const id = this.activeId();
        if (id === null) return;

        this.api.members(id).subscribe({
            next: list => {
                if (this.activeId() === id) this.members.set(list);
            },
            error: (err: HttpErrorResponse) =>
                this.panelError.set(errorText(err, 'Không tải được danh sách thành viên.')),
        });
    }

    private loadConversations(): void {
        this.api.conversations().subscribe({
            next: list => this.conversations.set(list),
            error: () => this.error.set('Không tải được danh sách cuộc trò chuyện.'),
        });
    }

    private onConversationsChanged(): void {
        this.api.conversations().subscribe({
            next: list => {
                this.conversations.set(list);
                void this.loadOnline();

                const id = this.activeId();
                if (id !== null && !list.some(c => c.id === id)) {
                    // bị xoá khỏi nhóm, hoặc nhóm không còn tồn tại
                    this.closeActive();
                } else if (this.showMembers()) {
                    this.loadMembers();
                }
            },
        });
    }

    private closeActive(): void {
        this.activeId.set(null);
        this.messages.set([]);
        this.hasMore.set(false);
        this.showMembers.set(false);
        this.members.set([]);
    }

    private refresh(): void {
        this.loadConversations();
        const id = this.activeId();
        if (id !== null) this.open(id);
        void this.loadOnline();
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
            if (m.senderId !== this.me()?.userId) this.markLatestRead();
        } else if (m.senderId !== this.me()?.userId) {
            this.unread.update(u => ({ ...u, [m.conversationId]: (u[m.conversationId] ?? 0) + 1 }));
        }
    }
    onDraftChange(value: string): void {
        this.draft.set(value);

        const id = this.activeId();
        const now = Date.now();
        if (id === null || !value.trim() || now - this.lastTypingSent < TYPING_SEND_INTERVAL) return;

        this.lastTypingSent = now;
        void this.hub.typing(id);
    }

    private onTyping(e: TypingEvent): void {
        if (e.userId === this.me()?.userId) return;

        this.typingUsers.update(all => ({
            ...all,
            [e.conversationId]: { ...(all[e.conversationId] ?? {}), [e.userId]: e.name },
        }));

        const key = `${e.conversationId}-${e.userId}`;
        clearTimeout(this.typingTimers.get(key));
        this.typingTimers.set(
            key,
            setTimeout(() => this.clearTyping(e.conversationId, e.userId), TYPING_EXPIRE)
        );
    }

    private clearTyping(conversationId: number, userId: number): void {
        this.typingTimers.delete(`${conversationId}-${userId}`);
        this.typingUsers.update(all => {
            const { [userId]: _removed, ...rest } = all[conversationId] ?? {};
            return { ...all, [conversationId]: rest };
        });
    }
    isOnline(c: ConversationDto): boolean {
        return c.type === 'direct' && c.otherUserId != null && this.onlineIds().has(c.otherUserId);
    }
    private async loadOnline(): Promise<void> {
        const ids = await this.hub.onlineUserIds();
        this.onlineIds.set(new Set(ids));
    }

    private onPresence(e: PresenceEvent): void {
        this.onlineIds.update(s => {
            const next = new Set(s);
            if (e.online) next.add(e.userId);
            else next.delete(e.userId);
            return next;
        });
    }

    // khi chuyển lại tab trình duyệt thì mới tính là đã đọc
    @HostListener('document:visibilitychange')
    onVisibilityChange(): void {
        this.markLatestRead();
    }

    private markLatestRead(): void {
        const id = this.activeId();
        const list = this.messages();
        const last = list[list.length - 1];

        if (id === null || !last || document.hidden) return;
        if (last.senderId === this.me()?.userId) return;

        void this.hub.markRead(id, last.id);
    }

    private loadReads(id: number): void {
        this.api.reads(id).subscribe({
            next: list => {
                if (this.activeId() !== id) return;
                const map: Record<number, number> = {};
                for (const r of list) {
                    if (r.lastReadMessageId != null) map[r.userId] = r.lastReadMessageId;
                }
                this.reads.set(map);
            },
        });
    }

    private onRead(e: ReadEvent): void {
        if (e.conversationId !== this.activeId()) return;
        this.reads.update(r => ({
            ...r,
            [e.userId]: Math.max(r[e.userId] ?? 0, e.messageId),
        }));
    }
      fileUrl(path: string | null | undefined): string {
    return path ? `${API_URL}${path}` : '';
  }

  isImage(m: MessageDto): boolean {
    return (m.attachmentContentType ?? '').startsWith('image/');
  }

  sizeText(bytes: number | null | undefined): string {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // dòng xem trước tin cuối trong danh sách cuộc trò chuyện
  lastText(c: ConversationDto): string {
    const m = c.lastMessage;
    if (!m) return 'Chưa có tin nhắn';
    if (m.content) return m.content;
    return m.attachmentName ? `📎 ${m.attachmentName}` : '';
  }

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // cho phép chọn lại cùng một file

    const id = this.activeId();
    if (!file || id === null) return;
    if (file.size > MAX_UPLOAD) {
      this.error.set('File quá lớn (tối đa 10 MB).');
      return;
    }

    this.uploading.set(true);
    this.error.set('');
    this.api.upload(id, file, this.draft().trim()).subscribe({
      next: () => {
        this.draft.set('');
        this.uploading.set(false);
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
        this.error.set(errorText(err, 'Không gửi được file.'));
      },
    });
  }

  // ảnh tải xong làm khung dài ra: nếu đang ở gần cuối thì cuộn xuống tiếp
  onImageLoad(): void {
    const el = this.scroller()?.nativeElement;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 400) {
      el.scrollTop = el.scrollHeight;
    }
  }

    private scrollToBottom(): void {
        setTimeout(() => {
            const el = this.scroller()?.nativeElement;
            if (el) el.scrollTop = el.scrollHeight;
        });
    }
}