import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AuthPage } from './pages/auth-page';
import { ChatPage } from './pages/chat-page';
import { ProfilePage } from './pages/profile-page';
import { UserProfilePage } from './pages/user-profile-page';

export const routes: Routes = [
  { path: 'login', component: AuthPage },
  { path: 'chat', component: ChatPage, canActivate: [authGuard] },
  { path: 'profile', component: ProfilePage, canActivate: [authGuard] },
  { path: 'profile/:id', component: UserProfilePage, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  { path: '**', redirectTo: 'chat' },
];