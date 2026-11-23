import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, switchMap, tap } from 'rxjs';
import { AuthService } from '../core/auth.service';
import { API_URL } from '../core/config';
import { ProfileApiService, ProfileDto } from '../core/profile-api.service';
import { ProfilePlayerCard } from '../shared/profile-player-card';

@Component({
  selector: 'app-user-profile-page',
  standalone: true,
  imports: [RouterLink, DatePipe, ProfilePlayerCard],
  template: `
    <div class="wrap">
      <a class="back" routerLink="/chat">← Quay lại chat</a>
         

      <div class="layout">
      <div class="main">

      @if (profile(); as p) {
        <div class="card">
          <div class="cover" [style.background-image]="p.coverUrl ? 'url(' + url(p.coverUrl) + ')' : null"></div>

          <div class="head">
            @if (p.avatarUrl) {
              <img class="avatar" [src]="url(p.avatarUrl)" alt="Ảnh đại diện" />
            } @else {
              <span class="avatar ph">{{ initial() }}</span>
            }
            <div class="names">
              <h2>{{ p.displayName ?? p.username }}</h2>
              <small>&#64;{{ p.username }} · Tham gia {{ p.createdAt | date: 'dd/MM/yyyy' }}</small>
            </div>
          </div>

          @if (p.bio) {
            <p class="bio">{{ p.bio }}</p>
          } @else {
            <p class="bio empty">Chưa có tiểu sử.</p>
          }
        </div>
      } @else {
        @if (error()) {
          <p class="error">{{ error() }}</p>
        } @else {
          <p class="loading">Đang tải hồ sơ...</p>
        }
      }
    </div>
      <div class="player-area">
  @if (targetId(); as id) {
    <app-profile-player-card [userId]="id" />
  }
</div>
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; min-height: 100vh; background: #f2f4f8; }
      .wrap { padding: 16px 16px calc(16px + var(--player-h, 0px)); }
      .layout { display: flex; align-items: flex-start; gap: 16px; }
      .main { flex: 0 0 640px; max-width: 100%; min-width: 0; }
      .player-area { flex: 1; min-width: 0; min-height: 300px; }
      @media (max-width: 1000px) {
        .layout { flex-direction: column; align-items: stretch; }
        .main { flex: none; max-width: 640px; }
      }
      .back { display: inline-block; margin-bottom: 12px; color: #3b6df0; text-decoration: none; }
      .card { background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); padding-bottom: 20px; }

      .cover { height: 180px; background: linear-gradient(135deg, #3b6df0, #8aa7f7) center / cover no-repeat; }

      .head { position: relative; z-index: 1; display: flex; align-items: flex-end; gap: 14px; padding: 0 20px; margin-top: -44px; }
      .avatar { display: block; width: 96px; height: 96px; border-radius: 50%; object-fit: cover; border: 4px solid #fff; background: #e4ebfd; }
      .avatar.ph { display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 600; color: #3b6df0; }
      .names { padding-bottom: 6px; }
      .names h2 { margin: 0; }
      .names small { color: #667085; }

      .bio { margin: 14px 20px 0; white-space: pre-wrap; word-break: break-word; color: #344054; }
      .bio.empty { color: #98a2b3; font-style: italic; }
      .error { color: #c62828; }
      .loading { color: #667085; }
    `,
  ],
})
export class UserProfilePage implements OnInit {
  private api = inject(ProfileApiService);
  private auth = inject(AuthService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  profile = signal<ProfileDto | null>(null);
  error = signal('');
  targetId = signal<number | null>(null);

  initial = computed(() => {
    const p = this.profile();
    return (p?.displayName ?? p?.username ?? '?').charAt(0).toUpperCase();
  });

  ngOnInit(): void {
    this.route.paramMap
      .pipe(
        tap(() => {
          this.profile.set(null);
          this.targetId.set(null);
          this.error.set('');
        }),
        switchMap(params => {
          const id = Number(params.get('id'));

          if (!Number.isInteger(id) || id <= 0) {
            this.error.set('Hồ sơ không hợp lệ.');
            return EMPTY;
          }

          // hồ sơ của chính mình thì chuyển sang trang sửa
          if (id === this.auth.user()?.userId) {
            void this.router.navigate(['/profile'], { replaceUrl: true });
            return EMPTY;
          }
          this.targetId.set(id);
          return this.api.get(id).pipe(
            catchError((err: HttpErrorResponse) => {
              this.error.set(
                err.status === 404 ? 'Không tìm thấy người dùng này.' : 'Không tải được hồ sơ.'
              );
              return EMPTY;
            })
          );
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe(p => this.profile.set(p));
  }

  url(path: string | null | undefined): string {
    return path ? `${API_URL}${path}` : '';
  }
}