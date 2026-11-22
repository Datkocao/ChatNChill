import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AuthPage } from './pages/auth-page';
import { ChatPage } from './pages/chat-page';
import { ProfilePage } from './pages/profile-page';
import { UserProfilePage } from './pages/user-profile-page';
import { MusicPage } from './pages/music-page';
import { ThemePage } from './pages/theme-page';
import { RoomPage } from './pages/room-page';

export const routes: Routes = [
  { path: 'music', component: MusicPage, canActivate: [authGuard] },
  { path: 'login', component: AuthPage },
  { path: 'chat', component: ChatPage, canActivate: [authGuard] },
  { path: 'profile', component: ProfilePage, canActivate: [authGuard] },
  { path: 'profile/:id', component: UserProfilePage, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  { path: 'music/theme', component: ThemePage, canActivate: [authGuard] },
  { path: 'rooms', component: RoomPage, canActivate: [authGuard] },
  { path: '**', redirectTo: 'chat' },
];