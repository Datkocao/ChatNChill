import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './config';

// khớp backend (MusicController: imports)
export interface ImportDto {
  id: number;
  url: string;
  title: string | null;
  status: 'queued' | 'processing' | 'failed';
  error: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class ImportApiService {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/Music/imports`;

  /** Gửi link lên, server trả về ngay (việc tải chạy nền). */
  start(url: string): Observable<ImportDto> {
    return this.http.post<ImportDto>(this.base, { url });
  }

  /** Các lần nhập đang chạy hoặc bị lỗi (nhập xong thì biến mất, bài nằm trong thư viện). */
  list(): Observable<ImportDto[]> {
    return this.http.get<ImportDto[]>(this.base);
  }

  /** Bỏ một lần nhập bị lỗi khỏi danh sách. */
  dismiss(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${id}`);
  }
}