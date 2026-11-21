import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './config';

export interface TrackDto {
  id: number;
  title: string;
  artist: string | null;
  durationSeconds: number | null;
  sizeBytes: number;
  createdAt: string;
}

export interface TrackList {
  tracks: TrackDto[];
  usedBytes: number;
  quotaBytes: number;
}

// Khớp với giới hạn ở MusicController, dùng để kiểm tra trước khi upload
export const MUSIC_MAX_FILE_BYTES = 30 * 1024 * 1024;
export const MUSIC_EXTENSIONS = ['.mp3', '.m4a', '.ogg', '.wav', '.flac'];

@Injectable({ providedIn: 'root' })
export class MusicApiService {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/Music`;

  list(): Observable<TrackList> {
    return this.http.get<TrackList>(`${this.base}/tracks`);
  }

  upload(file: File, title?: string, artist?: string, durationSeconds?: number | null): Observable<TrackDto> {
    const form = new FormData();
    form.append('file', file);
    if (title) form.append('title', title);
    if (artist) form.append('artist', artist);
    if (durationSeconds) form.append('durationSeconds', String(durationSeconds));
    return this.http.post<TrackDto>(`${this.base}/tracks`, form);
  }

  getUrl(id: number): Observable<{ url: string }> {
    return this.http.get<{ url: string }>(`${this.base}/tracks/${id}/url`);
  }

  delete(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/tracks/${id}`);
  }

  // Đọc độ dài bài từ chính file (giây), để gửi kèm khi upload
  readDuration(file: File): Promise<number | null> {
    return new Promise(resolve => {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      const done = (v: number | null) => {
        URL.revokeObjectURL(url);
        resolve(v);
      };
      a.preload = 'metadata';
      a.onloadedmetadata = () => done(isFinite(a.duration) ? Math.round(a.duration) : null);
      a.onerror = () => done(null);
      a.src = url;
    });
  }
}