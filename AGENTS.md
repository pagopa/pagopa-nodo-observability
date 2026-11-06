# AGENTS.md — Sviluppo Frontend Angular

Linee guida per agenti e sviluppatori che lavorano sul frontend della piattaforma di **osservabilità dei pagamenti del Nodo pagoPA**.

## Contesto di prodotto

- La piattaforma consente agli operatori di consultare, **in sola lettura**, stato e storia dei pagamenti logici e dei relativi tentativi.
- Riferimenti da leggere prima di implementare:
  - `docs/spec/Specifiche piattaforma osservabilita pagamenti.md` — perimetro, modello dati, retention, ruoli.
  - `docs/spec/FSM stati di pagamento.md` — stati e transizioni.
  - `docs/mockups/*.html` — mockup UI di riferimento (panoramica, pagamenti, dettaglio pagamento, enti creditori, dettaglio ente). Rispettare layout e gerarchia visiva.
  - `docs/analysis/` — analisi delle primitive del Nodo (utile per il significato degli eventi).
- Concetti di dominio:
  - **Pagamento logico** = coppia `(paFiscalCode, noticeNumber)`.
  - **Tentativo** = `paymentToken` (più tentativi per pagamento logico).
  - Pagamento logico e tentativo hanno **FSM separate**: non fondere né rinominare gli stati. Mostrare il valore originale del Nodo; eventuali categorie normalizzate sono solo aggiuntive.
  - Etichette uguali su entità diverse (es. `NOTICE_SENT`, `NOTIFIED`) vanno attribuite all'entità indicata dall'evento.
- Vincoli di prodotto:
  - Warning **solo visivi**, visibili finché lo stato non è risolto. Nessuna notifica esterna.
  - Il `paymentToken` in chiaro è visibile a **tutti gli utenti** della console (policy approvata il 22 ottobre 2026, supera la divergenza D-01): nessun mascheramento per ruolo. In questa fase non è previsto IAM; l'accesso è libero e `reveal`/`token-lookup` restano disponibili senza controllo di capacità.
  - Nessun payload completo di evento né dati di pagamento aggiuntivi nelle viste della proiezione. Eccezione approvata il 23 ottobre 2026: consultazione diagnostica RE separata dalla proiezione (modale on demand con tutti i campi; cronologia primitive del tentativo, senza payload, caricata in automatico nel dettaglio dal 2 novembre 2026; consultazione RE della posizione per PA + NAV senza token, solo su richiesta), con tutti i campi e payload Base64 decodificato come testo, senza persistenza nella proiezione o nei log. Piano: `docs/superpowers/plans/2026-10-23-recupero-tentativo-re.md`.
  - Retention 60 giorni per tentativo: la UI deve gestire con grazia dati scaduti/assenti.

## Stack e versioni

- Angular **ultima versione stabile**, TypeScript `strict`.
- **Standalone components** (niente NgModule), **Signals**, nuovo control flow (`@if`, `@for`, `@switch`), `inject()`.
- Build con l'Angular CLI (application builder), test con il runner configurato nel progetto.
- Prima di generare codice Angular, usare la skill `angular-developer` per le best practice aggiornate.

## Struttura consigliata

```
src/app/
  core/            # servizi singleton, interceptor, guard, config, auth
  shared/          # componenti, pipe, direttive riusabili e privi di dominio
  features/
    overview/            # panoramica / dashboard
    payments/            # lista + dettaglio pagamento (timeline stati, tentativi)
    creditor-entities/   # enti creditori + dettaglio ente
  models/          # interfacce e tipi di dominio (stati, DTO)
```

- Ogni feature è **lazy-loaded** via `loadChildren` / `loadComponent`.
- Le feature non si importano a vicenda: il codice condiviso va in `shared/` o `core/`.

## Convenzioni di codice

- File e selettori in **kebab-case**: `payment-timeline.component.ts`, selettore `app-payment-timeline`.
- Un componente = un file `.ts` + `.html` (+ `.scss`); template inline solo se molto brevi.
- Componenti con `changeDetection: ChangeDetectionStrategy.OnPush`.
- Input/output con le funzioni `input()`, `output()`, `model()`; query con `viewChild()`/`contentChild()`.
- Stato locale con `signal`, derivato con `computed`, sincronizzato con `linkedSignal`/`effect` (solo per side-effect reali). Evitare `BehaviorSubject` per stato di UI.
- Dati asincroni: `httpResource` / `resource` per le letture; RxJS solo dove serve (stream, debounce, combinazioni complesse).
- Evitare `any`; preferire `unknown` + type guard. Niente `!` non giustificati.
- Stati del Nodo come **union type / const object** tipizzati, mai stringhe sparse. Mappare stato → etichetta/colore in un unico punto (`models/` o pipe dedicata).
- Template senza logica pesante: spostarla in `computed` o in pipe pure.
- `track` obbligatorio in `@for` (usare un id stabile, es. `paymentToken`).
- Date/ore: gestire fuso orario in modo esplicito e formattare tramite `DatePipe`/utility condivisa; mostrare sempre la data-ora di ogni passaggio di stato.

## Dati e HTTP

- Accesso API solo tramite servizi in `core/` o nella feature (`*-api.service.ts`); i componenti non usano `HttpClient` direttamente.
- Interceptor funzionali (`HttpInterceptorFn`) per auth, errori e correlation id.
- DTO tipizzati separati dai modelli di UI; mapping esplicito.
- Gestire sempre stati **loading / empty / error** in ogni vista.
- Ricerca e filtri: parametri riflessi nell'URL (query params) per link condivisibili; paginazione server-side.
- Mai loggare o persistere in storage locale token di pagamento o dati sensibili.

## Sicurezza e ruoli

- In questa fase non c'è IAM: la `SessionService` mantiene un'identità demo fissa e la guard verifica solo la presenza della sessione locale. Nessun mascheramento di `paymentToken` (vedi Vincoli di prodotto). Mantenere comunque il punto unico di accesso alla sessione per un futuro aggancio IAM.
- Il controllo lato client è solo UX: l'autorizzazione reale, quando introdotta, sarà lato backend.
- Nessun `innerHTML` non sanitizzato; non bypassare il `DomSanitizer` senza motivazione documentata.

## UI, stile e accessibilità

- Seguire i mockup in `docs/mockups/`; riusare i design token (colori, spaziature, tipografia) definendoli come CSS custom properties.
- **Design system di riferimento: [pagopa/mui-italia](https://github.com/pagopa/mui-italia)** (tema MUI ispirato a Bootstrap Italia; docs: https://pagopa.github.io/mui-italia, Storybook su Chromatic).
  - `@pagopa/mui-italia` è una libreria **React/MUI + Emotion**: **non è utilizzabile direttamente in Angular**. Non aggiungere React, `@mui/material` o `@pagopa/mui-italia` come dipendenze.
  - Approccio per Angular: usare **Angular Material** (theming) come base dei componenti e allineare il tema a mui-italia — palette (inclusa la scala `italia`, blu Italia), font family, spaziature, raggi e ombre — replicando i valori del tema in un unico file di design token (`src/styles/_tokens.scss` + CSS custom properties).
  - Fonte di verità per i valori: il codice del tema in `pagopa/mui-italia` (`src/theme`) e lo Storybook; per i componenti, confrontare l'aspetto con lo Storybook e con i mockup.
  - Nessun colore, font o spaziatura hardcoded nei componenti: solo token.
  - Se mockup e mui-italia divergono, segnalarlo invece di scegliere in silenzio.
- Stili a livello componente; evitare `::ng-deep` e `!important`.
- Non inserire CSS nell'HTML (né tramite tag `<style>` né tramite attributi `style`): gli stili vanno nei relativi file `.scss`.
- Accessibilità (WCAG 2.1 AA, requisito PA): HTML semantico, ARIA solo dove serve, focus gestito, contrasto adeguato, **non affidarsi al solo colore** per gli stati/warning (aggiungere icona + testo), tabelle con intestazioni corrette.
- Responsive: layout valido da tablet a desktop come minimo.
- Testi UI in **italiano**; usare i18n se previsto più di una lingua. Codice, commenti e nomi in inglese.

## Test

- Unit test per servizi, pipe, guard, mapping stati e logica in `computed`.
- Test di componente con `TestBed` e harness; interrogare il DOM per ruolo/testo, non per classi CSS.
- Mockare l'HTTP con `provideHttpClientTesting`.
- Coprire i casi: loading, vuoto, errore, token sempre in chiaro, warning per stati non risolti.
- Ogni bug fix include un test di regressione.

## Qualità e workflow

- Prima di consegnare: `ng lint`, `ng test --watch=false`, `ng build` devono passare senza errori.
- Formattazione con Prettier, lint con ESLint (`angular-eslint`); non disabilitare regole senza commento esplicativo.
- Cambi piccoli e focalizzati; non introdurre nuove dipendenze senza necessità motivata.
- Commit in stile Conventional Commits (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- In caso di ambiguità sul dominio, consultare `docs/spec/` prima di assumere; segnalare le divergenze tra spec e mockup invece di sceglierne una in silenzio.

## Da evitare

- NgModule, `*ngIf`/`*ngFor`, `@Input()/@Output()` decorator-based nel codice nuovo.
- Subscribe manuali senza cleanup (usare `async`, `toSignal`, `takeUntilDestroyed`).
- Logica di business nei template o nei componenti di presentazione.
- Funzionalità di scrittura/modifica dei pagamenti: la piattaforma è **sola lettura**.
