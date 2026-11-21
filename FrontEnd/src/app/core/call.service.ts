import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Participant, Room, RoomEvent, Track } from 'livekit-client';
import { firstValueFrom } from 'rxjs';
import { API_URL } from './config';

interface CallToken { token: string; url: string; }
export type CallState = 'idle' | 'connecting' | 'connected';

// một ô trong lưới cuộc gọi
export interface CallTile {
  id: string;
  name: string;
  local: boolean;
  video: Track | null; // null = đang tắt camera, hiện chữ cái đầu tên
  micOn: boolean;
}

@Injectable({ providedIn: 'root' })
export class CallService {
  private http = inject(HttpClient);
  private room: Room | null = null;

  readonly state = signal<CallState>('idle');
  readonly conversationId = signal<number | null>(null);
  readonly micOn = signal(true);
  readonly camOn = signal(false);
  readonly tiles = signal<CallTile[]>([]);
  readonly participants = computed(() => this.tiles().map(t => t.name));
  readonly error = signal('');

  async join(conversationId: number): Promise<void> {
    if (this.state() !== 'idle') return;
    this.error.set('');
    this.state.set('connecting');
    this.conversationId.set(conversationId);

    const room = new Room();
    this.room = room;
    try {
      const res = await firstValueFrom(
        this.http.post<CallToken>(`${API_URL}/api/calls/${conversationId}/token`, {})
      );

      room.on(RoomEvent.TrackSubscribed, track => {
        // âm thanh: gắn thẻ <audio> vào trang. Video do TrackDirective lo.
        if (track.kind === Track.Kind.Audio) document.body.appendChild(track.attach());
        this.refreshTiles();
      });
      room.on(RoomEvent.TrackUnsubscribed, track => {
        if (track.kind === Track.Kind.Audio) track.detach().forEach(el => el.remove());
        this.refreshTiles();
      });
      room.on(RoomEvent.ParticipantConnected, () => this.refreshTiles());
      room.on(RoomEvent.ParticipantDisconnected, () => this.refreshTiles());
      room.on(RoomEvent.TrackMuted, () => this.refreshTiles());
      room.on(RoomEvent.TrackUnmuted, () => this.refreshTiles());
      room.on(RoomEvent.LocalTrackPublished, () => this.refreshTiles());
      room.on(RoomEvent.LocalTrackUnpublished, () => this.refreshTiles());
      room.on(RoomEvent.Disconnected, () => this.reset());

      await room.connect(res.url, res.token);
      await room.startAudio();
      await room.localParticipant.setMicrophoneEnabled(true);

      this.micOn.set(true);
      this.camOn.set(false);
      this.refreshTiles();
      this.state.set('connected');
    } catch (err) {
      await room.disconnect().catch(() => {});
      this.reset();
      this.error.set(this.errorText(err));
    }
  }

  async leave(): Promise<void> {
    const room = this.room;
    this.reset();
    if (room) await room.disconnect().catch(() => {});
  }

  async toggleMic(): Promise<void> {
    if (!this.room) return;
    const next = !this.micOn();
    try {
      await this.room.localParticipant.setMicrophoneEnabled(next);
      this.micOn.set(next);
      this.refreshTiles();
    } catch (err) {
      this.error.set(this.errorText(err));
    }
  }

  async toggleCamera(): Promise<void> {
    if (!this.room) return;
    this.error.set('');
    const next = !this.camOn();
    try {
      await this.room.localParticipant.setCameraEnabled(next);
      this.camOn.set(next);
      this.refreshTiles();
    } catch (err) {
      this.error.set(this.errorText(err));
    }
  }

  private refreshTiles(): void {
    const room = this.room;
    if (!room) return;

    const toTile = (p: Participant, local: boolean): CallTile => {
      const cam = p.getTrackPublication(Track.Source.Camera);
      const mic = p.getTrackPublication(Track.Source.Microphone);
      return {
        id: p.identity,
        name: local ? (p.name || 'Bạn') : (p.name || p.identity),
        local,
        video: cam && !cam.isMuted ? (cam.track ?? null) : null,
        micOn: !!mic && !mic.isMuted,
      };
    };

    this.tiles.set([
      toTile(room.localParticipant, true),
      ...Array.from(room.remoteParticipants.values()).map(p => toTile(p, false)),
    ]);
  }

  private reset(): void {
    this.room = null;
    this.state.set('idle');
    this.conversationId.set(null);
    this.tiles.set([]);
    this.micOn.set(true);
    this.camOn.set(false);
  }

  private errorText(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      return err.status === 403
        ? 'Bạn không ở trong cuộc trò chuyện này.'
        : 'Không xin được quyền vào cuộc gọi.';
    }
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      return 'Trình duyệt chưa cho phép dùng micro/camera. Hãy bấm Cho phép khi trình duyệt hỏi.';
    }
    if (err instanceof DOMException && err.name === 'NotFoundError') {
      return 'Không tìm thấy micro hoặc camera trên máy.';
    }
    if (err instanceof DOMException && err.name === 'NotReadableError') {
      return 'Không mở được camera (có thể ứng dụng khác đang dùng).';
    }
    return 'Không vào được cuộc gọi.';
  }
}