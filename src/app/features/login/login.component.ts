import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { map } from 'rxjs';
import { SessionService } from '../../core/auth/session.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly session = inject(SessionService);

  private readonly callbackUrl = toSignal(
    inject(ActivatedRoute).queryParamMap.pipe(map((params) => params.get('callbackUrl'))),
    { initialValue: null },
  );
  readonly configured = this.session.configured;
  readonly redirecting = signal(false);
  private readonly loginFailed = signal(false);
  readonly error = computed(() =>
    this.loginFailed()
      ? 'Impossibile avviare l’accesso con Microsoft. Riprova.'
      : this.session.error(),
  );

  async signIn(): Promise<void> {
    if (!this.configured || this.redirecting()) return;
    this.loginFailed.set(false);
    this.redirecting.set(true);
    try {
      await this.session.login(this.callbackUrl());
    } catch {
      this.loginFailed.set(true);
      this.redirecting.set(false);
    }
  }
}
