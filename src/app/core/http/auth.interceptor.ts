import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { SessionService } from '../auth/session.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(SessionService);
  const correlationId = crypto.randomUUID();
  return next(request.clone({
    setHeaders: {
      Authorization: `Bearer ${session.token()}`,
      'X-Correlation-ID': correlationId,
    },
  }));
};
