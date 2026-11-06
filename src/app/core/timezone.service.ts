import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class TimezoneService {
  readonly zone = signal('Europe/Rome');
}
