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

## Docker image (AKS)

The `Dockerfile` builds the Angular app and serves it with unprivileged nginx (UID 101) on port `8080`, under the `/ui/` base path (`/` keeps the redirect pages from `static/`). Configuration is compiled into the bundle, so build one image per environment:

```bash
docker build -t pagopa-nodo-observability-fe \
  --build-arg API_BASE_URL=https://api.example.com \
  --build-arg ENTRA_TENANT_ID=<tenant-id> \
  --build-arg ENTRA_CLIENT_ID=<client-id> \
  .
docker run --rm -p 8080:8080 pagopa-nodo-observability-fe
```

Optional build args: `ENTRA_REDIRECT_URI` (defaults to the app base URL, e.g. `https://<host>/ui/`, to be registered as SPA redirect URI in Entra ID), `ENTRA_SCOPES` and `BASE_HREF` (default `/ui/`: the public path of the SPA when an ingress exposes it under another prefix and rewrites it to `/ui/`; `release_deploy_aks.yml` derives it from `ingress.haproxy.path` in `helm/values-<env>.yaml`). Use `/healthz` for the liveness/readiness probes.
