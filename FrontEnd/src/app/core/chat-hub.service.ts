import { Injectable, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { API_URL } from './config';
import { MessageDto } from './models';

export type HubState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';
export interface TypingEvent { conversationId: number; userId: number; name: string; }
export interface PresenceEvent { userId: number; online: boolean; }
export interface ReadEvent { conversationId: number; userId: number; messageId: number; }

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

    async start(): Promise<void> {
        if (this.connection) return;

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


    async markRead(conversationId: number, messageId: number): Promise<void> {
        if (!this.connection || this.state() !== 'connected') return;
        try {
            await this.connection.invoke('MarkRead', conversationId, messageId);
        } catch {
            // tín hiệu "đã đọc" không quan trọng, bỏ qua lỗi
        }
    }
}