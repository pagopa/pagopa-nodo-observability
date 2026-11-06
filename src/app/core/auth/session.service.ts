import { Injectable, signal } from '@angular/core';
import { Session } from '../../models/domain';

// Single authorized identity: no role distinctions, full access, payment tokens in clear. No IAM in this phase:
// the backend resolves an implicit caller and ignores the credential, so this is the single place to wire a
// real identity later.
const DEMO_CREDENTIAL = 'DEMO_OPERATOR';

@Injectable({ providedIn: 'root' })
export class SessionService {
  readonly token = signal(DEMO_CREDENTIAL).asReadonly();
  readonly session = signal<Session | null>({
    id: 'demo-operator',
    authentication: 'LOCAL_DEMO_ONLY',
  });
}
