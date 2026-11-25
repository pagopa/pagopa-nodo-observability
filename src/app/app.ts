import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { SessionService } from './core/auth/session.service';
import { TimezoneService } from './core/timezone.service';
import { version } from '../../package.json';

@Component({
  selector: 'app-root',
  imports: [FormsModule, RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  readonly auth = inject(SessionService);
  readonly timezone = inject(TimezoneService);
  readonly timezoneValue = signal('Europe/Rome');
  readonly version = version;

  logout(): void {
    void this.auth.logout();
  }

  changeTimezone(value: string): void {
    this.timezoneValue.set(value);
    this.timezone.zone.set(value);
  }
}
