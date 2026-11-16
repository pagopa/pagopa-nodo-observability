import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService, safeCallbackUrl } from './session.service';

/** Protects every console route: unauthenticated users go to /login and come back afterwards. */
export const sessionGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  if (session.isAuthenticated()) return true;
  const callbackUrl = safeCallbackUrl(state.url);
  return inject(Router).createUrlTree(['/login'], {
    queryParams: callbackUrl ? { callbackUrl } : {},
  });
};

/** Keeps signed-in users away from the login page. */
export const loginGuard: CanActivateFn = (route) => {
  const session = inject(SessionService);
  if (!session.isAuthenticated()) return true;
  return inject(Router).parseUrl(
    safeCallbackUrl(route.queryParamMap.get('callbackUrl')) ?? '/overview',
  );
};
