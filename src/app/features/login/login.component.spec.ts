import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { SessionService } from '../../core/auth/session.service';
import { FakeMsal, provideFakeMsal } from '../../core/auth/testing/fake-msal';
import { LoginComponent } from './login.component';

async function render(fake: FakeMsal | null) {
  TestBed.configureTestingModule({
    providers: [
      provideFakeMsal(fake),
      provideRouter([{ path: 'login', component: LoginComponent }]),
    ],
  });
  await TestBed.inject(SessionService).initialize();
  const harness = await RouterTestingHarness.create('/login?callbackUrl=%2Fpayments');
  return harness.routeNativeElement as HTMLElement;
}

describe('LoginComponent', () => {
  it('starts the Microsoft redirect login towards the requested route', async () => {
    const fake = new FakeMsal();
    const page = await render(fake);
    const button = Array.from(page.querySelectorAll('button')).find((b) =>
      b.textContent?.includes('Accedi con Microsoft'),
    );

    button?.click();
    await vi.waitFor(() => expect(fake.loginRequests).toHaveLength(1));

    expect(fake.loginRequests[0].state).toBe('/payments');
  });

  it('shows a configuration alert when Entra ID is not configured', async () => {
    const page = await render(null);

    expect(page.querySelector('[role="alert"]')?.textContent).toContain('Accesso non configurato');
    expect(page.querySelector('button')).toBeNull();
  });
});
