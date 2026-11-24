import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { completeSilentAuthCallback, isSilentAuthCallback } from './app/core/auth/redirect-bridge';

if (isSilentAuthCallback(window)) {
  completeSilentAuthCallback().catch(() => console.error('Entra ID silent renewal callback failed'));
} else {
  bootstrapApplication(App, appConfig)
    .catch((err) => console.error(err));
}
