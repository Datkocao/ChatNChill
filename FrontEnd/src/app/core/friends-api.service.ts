import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { API_URL } from './config';
import { FriendDto, FriendRequestDto, UserSearchDto } from './models';

@Injectable({ providedIn: 'root' })
export class FriendsApiService {
  private http = inject(HttpClient);
  private base = `${API_URL}/api/friends`;

  friends(): Observable<FriendDto[]> {
    return this.http.get<FriendDto[]>(this.base);
  }

  requests(): Observable<FriendRequestDto[]> {
    return this.http.get<FriendRequestDto[]>(`${this.base}/requests`);
  }

  search(q: string): Observable<UserSearchDto[]> {
    return this.http.get<UserSearchDto[]>(`${this.base}/search`, {
      params: new HttpParams().set('q', q),
    });
  }

  sendRequest(username: string): Observable<void> {
    return this.http.post<void>(`${this.base}/requests`, { username });
  }

  accept(requestId: number): Observable<void> {
    return this.http.post<void>(`${this.base}/requests/${requestId}/accept`, {});
  }

  deleteRequest(requestId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/requests/${requestId}`);
  }

  unfriend(userId: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/${userId}`);
  }
}