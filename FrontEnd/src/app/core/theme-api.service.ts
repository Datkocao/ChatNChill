import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './config';

// khớp backend (ThemeImagesController)
export const THEME_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
export const THEME_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

@Injectable({ providedIn: 'root' })
export class ThemeApiService {
  private http = inject(HttpClient);

  /** Tải ảnh lên R2, trả về đường dẫn tương đối để lưu vào theme. */
  upload(file: File): Observable<{ url: string }> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<{ url: string }>(`${API_URL}/api/theme-images`, form);
  }
}