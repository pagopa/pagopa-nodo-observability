# Deployment

GitHub Actions keeps the existing release/version flow and deploys the Angular
static build to Azure Storage Static Website under `/ui/`. The `code_review`
workflow runs the Angular build, lint, unit tests, contract tests, and Sonar
analysis for pull requests and pushes to `main`.

The `release_deploy` workflow retains the existing release triggers and
environment/version selection. The deploy job runs on the `self-hosted-job`
runner labelled with the resolved environment (`dev` by default, or `uat` or
`prod`). It builds with Node.js 24 and npm, syncs
`dist/observability/browser` to `$web/ui/`, and uploads `static/` to the root
without deleting other blobs. The Front Door purge step is currently disabled.

The runner must have Docker available for `azure/CLI` and network access to the
storage account's Blob private endpoint. Its DNS must resolve the normal Blob
hostname to that private endpoint; a storage connection string supplies
credentials but does not provide private network access.

## GitHub configuration

Set these variables for each GitHub Environment (`dev`, `uat`, and `prod`):

- `API_BASE_URL`: the absolute HTTPS base URL of that environment's backend.
  Do not include credentials, a query string, or a fragment. This value is
  included in the public frontend bundle and must not be a secret.
- `STORAGE_ACCOUNT`
- `CD_RESOURCE_GROUP`
- `CD_ENDPOINT`
- `CD_PROFILE`

The workflow also requires the existing secrets `BOT_TOKEN_GITHUB`,
`CD_CLIENT_ID`, `TENANT_ID`, `SUBSCRIPTION_ID`, and `BLOB_CONNECTION_STRING`.
Use GitHub Environment protection rules to require approval before deployment
to `uat` or `prod`, if needed.

## Azure and backend configuration

The Angular build sets `/ui/` as its base path. Azure must serve the app at that
path and route deep links such as `/ui/payments` back to `/ui/index.html`.
The backend must allow CORS requests from the deployed UI origin. Front Door
routing, SPA fallback, and backend CORS are infrastructure settings and are
not changed by this repository's workflow.
