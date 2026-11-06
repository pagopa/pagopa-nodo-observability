import { Routes } from '@angular/router';
import { sessionGuard } from './core/auth/session.guard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'overview' },
  { path: 'overview', canActivate: [sessionGuard], loadComponent: () => import('./features/overview/overview.component').then(m => m.OverviewComponent) },
  { path: 'payments', canActivate: [sessionGuard], loadComponent: () => import('./features/payments/payments.component').then(m => m.PaymentsComponent) },
  { path: 'payments/:paFiscalCode/:noticeNumber', canActivate: [sessionGuard], loadComponent: () => import('./features/payments/payment-detail.component').then(m => m.PaymentDetailComponent) },
  { path: 'creditor-entities', canActivate: [sessionGuard], loadComponent: () => import('./features/creditor-entities/creditors.component').then(m => m.CreditorsComponent) },
  { path: 'creditor-entities/:paFiscalCode', canActivate: [sessionGuard], loadComponent: () => import('./features/creditor-entities/creditor-detail.component').then(m => m.CreditorDetailComponent) },
  { path: '**', redirectTo: 'overview' },
];
