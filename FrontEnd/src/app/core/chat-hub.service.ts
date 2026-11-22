import { Injectable, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { API_URL } from './config';
import { MessageDto, RoomInviteDto, RoomStateDto } from './models';

export type HubState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export interface TypingEvent { conversationId: number; userId: number; name: string; }
export interface PresenceEvent { userId: number; online: boolean; }
export interface ReadEvent { conversationId: number; userId: number; messageId: number; }
export interface ProfileEvent { userId: number; displayName: string; avatarUrl: string | null; }
export interface CallEvent { conversationId: number; callerId: number; callerName: string; }

@Injectable({ providedIn: 'root' })
export class ChatHubService {
    private auth = inject(AuthService);
    private connection: signalR.HubConnection | null = null;

    readonly conversationsChanged$ = new Subject<void>();
    readonly state = signal<HubState>('disconnected');
    readonly messages$ = new Subject<MessageDto>();
    readonly reconnected$ = new Subject<void>();
    readonly typing$ = new Subject<TypingEvent>();
    readonly presence$ = new Subject<PresenceEvent>();
    readonly friendsChanged$ = new Subject<void>();
    readonly reads$ = new Subject<ReadEvent>();
    readonly profileChanged$ = new Subject<ProfileEvent>();
    readonly incomingCall$ = new Subject<CallEvent>();
    readonly roomState$ = new Subject<RoomStateDto>();
    readonly roomInvite$ = new Subject<RoomInviteDto>();
    readonly roomLeft$ = new Subject<string>();   // roomId của phòng vừa rời (hoặc bị đưa ra khỏi)

       private starting: Promise<void> | null = null;

    start(): Promise<void> {
        if (!this.starting) this.starting = this.doStart();
        return this.starting;
    }

    private async doStart(): Promise<void> {

        const conn = new signalR.HubConnectionBuilder()
            .withUrl(`${API_URL}/hubs/chat`, {
                accessTokenFactory: () => this.auth.token ?? '',
            })
            .withAutomaticReconnect()
            .build();

        conn.on('ReceiveMessage', (m: MessageDto) => this.messages$.next(m));
        conn.on('ConversationsChanged', () => this.conversationsChanged$.next());
        conn.on('FriendsChanged', () => this.friendsChanged$.next());
        conn.on('UserTyping', (e: TypingEvent) => this.typing$.next(e));
        conn.on('UserOnline', (userId: number) => this.presence$.next({ userId, online: true }));
        conn.on('UserOffline', (userId: number) => this.presence$.next({ userId, online: false }));
        conn.on('MessagesRead', (e: ReadEvent) => this.reads$.next(e));
        conn.on('ProfileChanged', (e: ProfileEvent) => this.profileChanged$.next(e));
        conn.on('IncomingCall', (e: CallEvent) => this.incomingCall$.next(e));
        conn.on('RoomState', (e: RoomStateDto) => this.roomState$.next(e));
        conn.on('RoomInvite', (e: RoomInviteDto) => this.roomInvite$.next(e));
        conn.on('RoomLeft', (roomId: string) => this.roomLeft$.next(roomId));
        conn.onreconnecting(() => this.state.set('reconnecting'));
        conn.onreconnected(() => {
            this.state.set('connected');
            this.reconnected$.next();
        });
        conn.onclose(() => this.state.set('disconnected'));

        this.connection = conn;
        this.state.set('connecting');

        try {
            await conn.start();
            this.starting = null;
            this.state.set('connected');
        } catch (err) {
            this.connection = null;
            this.state.set('disconnected');
            throw err;
        }
    }

    async stop(): Promise<void> {
        const conn = this.connection;
        this.connection = null;
        this.starting = null;
        this.state.set('disconnected');
        if (conn) {
            await conn.stop();
        }
    }

    async send(conversationId: number, content: string): Promise<void> {
        if (!this.connection || this.state() !== 'connected') {
            throw new Error('Chưa kết nối tới máy chủ chat.');
        }
        await this.connection.invoke('SendMessage', conversationId, content);
    }

    async typing(conversationId: number): Promise<void> {
        if (!this.connection || this.state() !== 'connected') return;
        try {
            await this.connection.invoke('Typing', conversationId);
        } catch {
            // tín hiệu "đang gõ" không quan trọng, bỏ qua lỗi
        }
    }

    async onlineUserIds(): Promise<number[]> {
        if (!this.connection || this.state() !== 'connected') return [];
        try {
            return await this.connection.invoke<number[]>('GetOnlineUserIds');
        } catch {
            return [];
        }
    }

        async notifyCall(conversationId: number): Promise<void> {
        if (!this.connection || this.state() !== 'connected') return;
        try {
            await this.connection.invoke('NotifyCall', conversationId);
        } catch {
            // báo cuộc gọi không quan trọng, bỏ qua lỗi
        }
    }

    async markRead(conversationId: number, messageId: number): Promise<void> {
        if (!this.connection || this.state() !== 'connected') return;
        try {
            await this.connection.invoke('MarkRead', conversationId, messageId);
        } catch {
            // tín hiệu "đã đọc" không quan trọng, bỏ qua lỗi
        }
    }

        // ---------- Phòng nghe nhạc ----------
    // Khác các hàm trên: lỗi KHÔNG bị nuốt, để giao diện hiện thông báo (ví dụ "Chỉ chủ phòng mới điều khiển được nhạc.")

    private async invokeRoom<T = void>(method: string, ...args: unknown[]): Promise<T> {
        if (!this.connection || this.state() !== 'connected') {
            throw new Error('Chưa kết nối tới máy chủ.');
        }
        try {
            return await this.connection.invoke<T>(method, ...args);
        } catch (e) {
            // SignalR bọc lỗi dạng "... HubException: <nội dung>", chỉ lấy phần nội dung
            const raw = e instanceof Error ? e.message : String(e);
            const m = /HubException:\s*(.*)$/s.exec(raw);
            throw new Error(m ? m[1].trim() : 'Có lỗi khi gọi máy chủ.');
        }
    }

    createRoom(name: string): Promise<RoomStateDto> { return this.invokeRoom('CreateRoom', name); }
    inviteToRoom(roomId: string, friendIds: number[]): Promise<void> { return this.invokeRoom('InviteToRoom', roomId, friendIds); }
    joinRoom(roomId: string): Promise<RoomStateDto> { return this.invokeRoom('JoinRoom', roomId); }
    leaveRoom(roomId: string): Promise<void> { return this.invokeRoom('LeaveRoom', roomId); }
    getRoomState(roomId: string): Promise<RoomStateDto | null> { return this.invokeRoom('GetRoomState', roomId); }

    roomAddTrack(roomId: string, trackId: number): Promise<void> { return this.invokeRoom('RoomAddTrack', roomId, trackId); }
    roomRemoveTrack(roomId: string, index: number): Promise<void> { return this.invokeRoom('RoomRemoveTrack', roomId, index); }
    roomMoveTrack(roomId: string, from: number, to: number): Promise<void> { return this.invokeRoom('RoomMoveTrack', roomId, from, to); }
    roomPlay(roomId: string, index: number | null = null): Promise<void> { return this.invokeRoom('RoomPlay', roomId, index); }
    roomPause(roomId: string): Promise<void> { return this.invokeRoom('RoomPause', roomId); }
    roomSeek(roomId: string, seconds: number): Promise<void> { return this.invokeRoom('RoomSeek', roomId, seconds); }
    roomNext(roomId: string): Promise<void> { return this.invokeRoom('RoomNext', roomId); }
    roomPrev(roomId: string): Promise<void> { return this.invokeRoom('RoomPrev', roomId); }
    roomTrackEnded(roomId: string, index: number): Promise<void> { return this.invokeRoom('RoomTrackEnded', roomId, index); }
}