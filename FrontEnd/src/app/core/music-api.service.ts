import { HttpClient, HttpParams } from '@angular/common/http';
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
  uploaderId: number;
  uploaderName?: string | null;
  origin: string;        // 'Upload' | 'Youtube'
  inLibrary: boolean;    // đã nằm trong danh sách của mình chưa
}

export interface TrackList {
  tracks: TrackDto[];
  usedBytes: number;
  quotaBytes: number;
}

export interface SearchResult {
  videoId: string;
  title: string;
  channel: string | null;
  durationSeconds: number;
}

export interface LibraryPage {
  tracks: TrackDto[];
  total: number;
  page: number;
  pageSize: number;
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

    // Kho chung: tìm kiếm + phân trang
  library(q: string, page: number): Observable<LibraryPage> {
    let params = new HttpParams().set('page', page);
    if (q) params = params.set('q', q);
    return this.http.get<LibraryPage>(`${this.base}/library`, { params });
  }

  // Thêm một bài trong kho vào danh sách của mình
  addToMine(id: number): Observable<void> {
    return this.http.post<void>(`${this.base}/tracks/${id}/add`, {});
  }

    // Tìm bài trên YouTube theo tên (tối đa 5 kết quả)
  search(q: string): Observable<SearchResult[]> {
    return this.http.get<SearchResult[]>(`${this.base}/search`, { params: new HttpParams().set('q', q) });
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