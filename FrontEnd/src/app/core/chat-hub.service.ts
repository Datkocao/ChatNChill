import { Injectable, inject, signal } from '@angular/core';
import * as signalR from '@microsoft/signalr';
import { Subject } from 'rxjs';
import { AuthService } from './auth.service';
import { API_URL } from './config';
import { MessageDto } from './models';

export type HubState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting';

@Injectable({ providedIn: 'root' })
export class ChatHubService {
  private auth = inject(AuthService);
  private connection: signalR.HubConnection | null = null;

  readonly state = signal<HubState>('disconnected');
  readonly messages$ = new Subject<MessageDto>();
  readonly reconnected$ = new Subject<void>();

  async start(): Promise<void> {
    if (this.connection) return;

    const conn = new signalR.HubConnectionBuilder()
      .withUrl(`${API_URL}/hubs/chat`, {
        accessTokenFactory: () => this.auth.token ?? '',
      })
      .withAutomaticReconnect()
      .build();

    conn.on('ReceiveMessage', (m: MessageDto) => this.messages$.next(m));
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
}