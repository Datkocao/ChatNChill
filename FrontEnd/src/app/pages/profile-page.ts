import { HttpErrorResponse } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { API_URL } from '../core/config';
import { ProfileApiService, ProfileDto } from '../core/profile-api.service';
import { ProfilePlayerCard } from '../shared/profile-player-card';

const MAX_AVATAR = 5 * 1024 * 1024; // khớp backend
const MAX_COVER = 8 * 1024 * 1024;
const MAX_BIO = 300;

const errorText = (err: HttpErrorResponse, fallback: string): string =>
  err.error?.message ?? fallback;

@Component({
  selector: 'app-profile-page',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, ProfilePlayerCard],
  template: `
    <div class="wrap">
      <a class="back" routerLink="/chat">← Quay lại chat</a>
      

      <div class="layout">
      <div class="main">

      @if (profile(); as p) {
        <div class="card">
          <div class="cover" [style.background-image]="p.coverUrl ? 'url(' + url(p.coverUrl) + ')' : null">
            <input
              #coverInput
              type="file"
              hidden
              accept=".jpg,.jpeg,.png,.gif,.webp"
              (change)="onPick($event, 'cover')"
            />
            <button type="button" class="cover-btn" [disabled]="uploading()" (click)="coverInput.click()">
              Đổi ảnh bìa
            </button>
          </div>

          <div class="head">
            <input
              #avatarInput
              type="file"
              hidden
              accept=".jpg,.jpeg,.png,.gif,.webp"
              (change)="onPick($event, 'avatar')"
            />
            <button type="button" class="avatar-btn" [disabled]="uploading()" (click)="avatarInput.click()" title="Đổi ảnh đại diện">
              @if (p.avatarUrl) {
                <img class="avatar" [src]="url(p.avatarUrl)" alt="Ảnh đại diện" />
              } @else {
                <span class="avatar ph">{{ initial() }}</span>
              }
            </button>
            <div class="names">
              <h2>{{ p.displayName ?? p.username }}</h2>
              <small>&#64;{{ p.username }} · Tham gia {{ p.createdAt | date: 'dd/MM/yyyy' }}</small>
            </div>
          </div>

          @if (p.bio) {
            <p class="bio">{{ p.bio }}</p>
          }

          <form class="form" (ngSubmit)="save()">
            <label>
              Tên hiển thị
              <input
                name="displayName"
                maxlength="50"
                autocomplete="off"
                [ngModel]="displayName()"
                (ngModelChange)="displayName.set($event)"
              />
            </label>

            <label>
              Tiểu sử <small>({{ bio().length }}/{{ maxBio }})</small>
              <textarea
                name="bio"
                rows="4"
                [attr.maxlength]="maxBio"
                [ngModel]="bio()"
                (ngModelChange)="bio.set($event)"
              ></textarea>
            </label>

            @if (error()) {
              <p class="error">{{ error() }}</p>
            }
            @if (message()) {
              <p class="ok">{{ message() }}</p>
            }

            <button type="submit" class="primary" [disabled]="saving() || uploading()">
              {{ saving() ? 'Đang lưu...' : 'Lưu thay đổi' }}
            </button>
          </form>
        </div>
      } @else {
        @if (error()) {
          <p class="error">{{ error() }}</p>
        } @else {
          <p class="loading">Đang tải hồ sơ...</p>
        }
      }
    </div>
    <div class="player-area"><app-profile-player-card /></div>
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
      .card { background: #fff; border-radius: 14px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.08); }

      .cover { position: relative; height: 180px; background: linear-gradient(135deg, #3b6df0, #8aa7f7) center / cover no-repeat; }
      .cover-btn { position: absolute; right: 12px; bottom: 12px; padding: 6px 12px; border: 0; border-radius: 8px; background: rgba(0,0,0,.55); color: #fff; cursor: pointer; }

            .head { position: relative; z-index: 1; display: flex; align-items: flex-end; gap: 14px; padding: 0 20px; margin-top: -44px; }
      .avatar-btn { padding: 0; border: 0; background: none; cursor: pointer; border-radius: 50%; }
      .avatar { display: block; width: 96px; height: 96px; border-radius: 50%; object-fit: cover; border: 4px solid #fff; background: #e4ebfd; }
      .avatar.ph { display: flex; align-items: center; justify-content: center; font-size: 36px; font-weight: 600; color: #3b6df0; }
      .names { padding-bottom: 6px; }
      .names h2 { margin: 0; }
      .names small { color: #667085; }

      .bio { margin: 14px 20px 0; white-space: pre-wrap; word-break: break-word; color: #344054; }

      .form { display: flex; flex-direction: column; gap: 14px; padding: 20px; }
      .form label { display: flex; flex-direction: column; gap: 6px; font-size: 14px; font-weight: 600; }
      .form label small { font-weight: 400; color: #667085; }
      .form input, .form textarea { padding: 9px 11px; border: 1px solid #cfd6e0; border-radius: 8px; font: inherit; font-weight: 400; resize: vertical; }
      .primary { align-self: flex-start; padding: 9px 18px; border: 0; border-radius: 8px; background: #3b6df0; color: #fff; cursor: pointer; }
      button[disabled] { opacity: .5; cursor: default; }
      .error { color: #c62828; margin: 0; font-size: 13px; }
      .ok { color: #2e7d32; margin: 0; font-size: 13px; }
      .loading { color: #667085; }
    `,
  ],
})
export class ProfilePage implements OnInit {
  private api = inject(ProfileApiService);
  private auth = inject(AuthService);

  readonly maxBio = MAX_BIO;

  profile = signal<ProfileDto | null>(null);
  displayName = signal('');
  bio = signal('');
  saving = signal(false);
  uploading = signal(false);
  error = signal('');
  message = signal('');

  initial = computed(() => {
    const p = this.profile();
    return (p?.displayName ?? p?.username ?? '?').charAt(0).toUpperCase();
  });

  ngOnInit(): void {
    this.api.me().subscribe({
      next: p => this.setProfile(p),
      error: () => this.error.set('Không tải được hồ sơ.'),
    });
  }

  url(path: string | null | undefined): string {
    return path ? `${API_URL}${path}` : '';
  }

  save(): void {
    this.error.set('');
    this.message.set('');
    this.saving.set(true);

    this.api.update(this.displayName(), this.bio()).subscribe({
      next: p => {
        this.saving.set(false);
        this.setProfile(p);
        // cập nhật tên đang hiện ở thanh bên của trang chat
        this.auth.setDisplayName(p.displayName ?? p.username);
        this.message.set('Đã lưu.');
      },
      error: (err: HttpErrorResponse) => {
        this.saving.set(false);
        this.error.set(errorText(err, 'Không lưu được hồ sơ.'));
      },
    });
  }

  onPick(event: Event, kind: 'avatar' | 'cover'): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // cho phép chọn lại cùng một file
    if (!file) return;

    const max = kind === 'avatar' ? MAX_AVATAR : MAX_COVER;
    if (file.size > max) {
      this.error.set(`Ảnh quá lớn (tối đa ${max / 1024 / 1024} MB).`);
      return;
    }

    this.error.set('');
    this.message.set('');
    this.uploading.set(true);

    const request = kind === 'avatar' ? this.api.uploadAvatar(file) : this.api.uploadCover(file);
    request.subscribe({
      next: p => {
        this.uploading.set(false);
        // chỉ cập nhật ảnh, giữ nguyên chữ người dùng đang gõ dở trong form
        this.profile.set(p);
      },
      error: (err: HttpErrorResponse) => {
        this.uploading.set(false);
        this.error.set(errorText(err, 'Không tải ảnh lên được.'));
      },
    });
  }

  private setProfile(p: ProfileDto): void {
    this.profile.set(p);
    this.displayName.set(p.displayName ?? p.username);
    this.bio.set(p.bio ?? '');
  }
}