# Build stage: Angular production build with the deployment environment generated from build args.
FROM node:24.15.0-alpine@sha256:d1b3b4da11eefd5941e7f0b9cf17783fc99d9c6fc34884a665f40a06dbdfc94f AS build
WORKDIR /app

# Public, build-time settings (they end up in the JS bundle): see scripts/deployment-environment.mjs.
ARG API_BASE_URL
ARG ENTRA_TENANT_ID
ARG ENTRA_CLIENT_ID
ARG ENTRA_REDIRECT_URI=""
ARG ENTRA_SCOPES=""
# Public URL path of the SPA (the AKS ingress path + "/"); nginx always serves it under /ui/.
ARG BASE_HREF=/ui/

# Copy the lockfile before installation so the image uses the same dependency versions as CI.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN API_BASE_URL="$API_BASE_URL" \
    ENTRA_TENANT_ID="$ENTRA_TENANT_ID" \
    ENTRA_CLIENT_ID="$ENTRA_CLIENT_ID" \
    ENTRA_REDIRECT_URI="$ENTRA_REDIRECT_URI" \
    ENTRA_SCOPES="$ENTRA_SCOPES" \
    node scripts/deployment-environment.mjs \
  && npm run build -- --configuration production,deployment --base-href "$BASE_HREF"

# Production stage: static files served by unprivileged nginx (UID 101, port 8080).
FROM nginxinc/nginx-unprivileged:1.29-alpine@sha256:0c79d56aee561a1d81c63f00eee5fb5fe29279560cdc55e91425133104c7fbe6 AS production

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/security-headers.conf /etc/nginx/snippets/security-headers.conf
# Same layout as the storage account: root redirect/error pages and the SPA under /ui/.
COPY static/ /usr/share/nginx/html/
COPY --from=build /app/dist/observability/browser/ /usr/share/nginx/html/ui/

USER 101
EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
