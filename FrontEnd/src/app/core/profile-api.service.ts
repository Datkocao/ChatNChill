import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './config';

export interface ProfileDto {
  userId: number;
  username: string;
  displayName: string | null;
  avatarUrl: string | null;
  coverUrl: string | null;
  bio: string | null;
  createdAt: string;
}

@Injectable({ providedIn: 'root' })
export class ProfileApiService {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/profile`;

  me(): Observable<ProfileDto> {
    return this.http.get<ProfileDto>(`${this.base}/me`);
  }

  update(displayName: string, bio: string): Observable<ProfileDto> {
    return this.http.put<ProfileDto>(`${this.base}/me`, { displayName, bio });
  }
    get(userId: number): Observable<ProfileDto> {
    return this.http.get<ProfileDto>(`${this.base}/${userId}`);
  }

  uploadAvatar(file: File): Observable<ProfileDto> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ProfileDto>(`${this.base}/avatar`, form);
  }

  uploadCover(file: File): Observable<ProfileDto> {
    const form = new FormData();
    form.append('file', file);
    return this.http.post<ProfileDto>(`${this.base}/cover`, form);
  }
}