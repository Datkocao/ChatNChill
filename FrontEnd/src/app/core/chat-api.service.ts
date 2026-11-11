import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './config';
import { ConversationDto, MessageDto } from './models';

@Injectable({ providedIn: 'root' })
export class ChatApiService {
  private http = inject(HttpClient);

  conversations(): Observable<ConversationDto[]> {
    return this.http.get<ConversationDto[]>(`${API_URL}/api/conversations`);
  }

  startDirect(username: string): Observable<ConversationDto> {
    return this.http.post<ConversationDto>(`${API_URL}/api/conversations/direct`, { username });
  }

  messages(conversationId: number, before?: number, limit = 30): Observable<MessageDto[]> {
    let params = new HttpParams().set('limit', limit);
    if (before !== undefined) {
      params = params.set('before', before);
    }
    return this.http.get<MessageDto[]>(
      `${API_URL}/api/conversations/${conversationId}/messages`,
      { params }
    );
  }
}