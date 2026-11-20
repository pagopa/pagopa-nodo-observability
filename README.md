# pagoPA Nodo Observability

An Angular web console for viewing the status and history of payments and their payment attempts. The application is read-only and retrieves
its data from the `pagopa-node-technical-support-worker` backend.

## Technology

- Angular 22 with TypeScript
- Angular Material and SCSS
- RxJS
- Vitest for unit tests

## Run locally

### Prerequisites

- Node.js `^22.22.3`, `^24.15.0`, or `>=26.0.0`
- npm
- The `pagopa-node-technical-support-worker` backend running locally in its
  development profile on port `8080`

Install dependencies and start the frontend from the project root:

```bash
npm ci
npm start
```

Open [http://localhost:4201](http://localhost:4201). The development
configuration connects to the backend at `http://localhost:8080`; the backend
must allow requests from `http://localhost:4201`.
