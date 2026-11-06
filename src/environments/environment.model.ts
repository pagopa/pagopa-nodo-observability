/**
 * Forma dei parametri di backend esposti tramite environment.
 *
 * NOTA: i valori finiscono nel bundle del browser. Inserire solo parametri
 * NON sensibili (URL, flag). Nessun segreto o token.
 */
export interface Environment {
  /** `true` nelle build di produzione, `false` in sviluppo. */
  readonly production: boolean;
  /**
   * Base URL del backend di osservabilità, usata come prefisso per tutte
   * le chiamate REST e per lo stream SSE degli eventi.
   *
   * - In produzione: origin assoluta del backend, es. `https://nodo-observability.pagopa.it`.
   * - In sviluppo: origin del worker locale (`http://localhost:8080`), con CORS
   *   abilitato lato backend; in alternativa stringa vuota + proxy same-origin
   *   (vedi `proxy.conf.cjs`).
   */
  readonly apiBaseUrl: string;
}
