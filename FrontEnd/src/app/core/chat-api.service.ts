import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './config';
import { ConversationDto, MemberDto, MessageDto, ReadDto } from './models';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/conversations`;

  conversations(): Observable<ConversationDto[]> {
    return this.http.get<ConversationDto[]>(this.base);
  }

  startDirect(username: string): Observable<ConversationDto> {
    return this.http.post<ConversationDto>(`${this.base}/direct`, { username });
  }

  messages(conversationId: number, before?: number, limit = 30): Observable<MessageDto[]> {
    let params = new HttpParams().set('limit', limit);
    if (before !== undefined) {
      params = params.set('before', before);
    }
    return this.http.get<MessageDto[]>(`${this.base}/${conversationId}/messages`, { params });
  }

    reads(conversationId: number): Observable<ReadDto[]> {
    return this.http.get<ReadDto[]>(`${this.base}/${conversationId}/reads`);
  }

    upload(conversationId: number, file: File, content = ''): Observable<MessageDto> {
    const form = new FormData();
    form.append('file', file);
    form.append('content', content);
    return this.http.post<MessageDto>(`${this.base}/${conversationId}/attachments`, form);
  }

  createGroup(name: string, usernames: string[]): Observable<ConversationDto> {
    return this.http.post<ConversationDto>(`${this.base}/group`, { name, usernames });
  }

  members(conversationId: number): Observable<MemberDto[]> {
    return this.http.get<MemberDto[]>(`${this.base}/${conversationId}/members`);
  }

  addMembers(conversationId: number, usernames: string[]): Observable<void> {
    return this.http.post<void>(`${this.base}/${conversationId}/members`, { usernames });
  }

  removeMember(conversationId: number, userId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${conversationId}/members/${userId}`);
  }

  leave(conversationId: number): Observable<void> {
    return this.http.post<void>(`${this.base}/${conversationId}/leave`, {});
  }

  rename(conversationId: number, name: string): Observable<void> {
    return this.http.put<void>(`${this.base}/${conversationId}`, { name });
  }
}