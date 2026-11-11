import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';
import { AuthPage } from './pages/auth-page';
import { ChatPage } from './pages/chat-page';

export const routes: Routes = [
  { path: 'login', component: AuthPage },
  { path: 'chat', component: ChatPage, canActivate: [authGuard] },
  { path: '', pathMatch: 'full', redirectTo: 'chat' },
  { path: '**', redirectTo: 'chat' },
];