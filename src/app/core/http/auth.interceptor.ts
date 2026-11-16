import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, from, switchMap, throwError } from 'rxjs';
import { SessionService } from '../auth/session.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const session = inject(SessionService);
  const correlationId = crypto.randomUUID();
  return from(session.acquireToken()).pipe(
    switchMap((token) =>
      next(
        request.clone({
          setHeaders: {
            Authorization: `Bearer ${token}`,
            'X-Correlation-ID': correlationId,
          },
        }),
      ),
    ),
    catchError((error: unknown) => {
      if (error instanceof HttpErrorResponse && error.status === 401)
        void session.handleUnauthorized();
      return throwError(() => error);
    }),
  );
};
