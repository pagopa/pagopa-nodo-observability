import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';
import { SessionService } from './session.service';

export const sessionGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  return session.session() !== null;
};
