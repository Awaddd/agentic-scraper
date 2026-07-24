# ADR-0005: Deploy the browser stack with Docker Compose

**Status:** Accepted

## Context

The service requires an HTTP API, a browser-control service, persistent recordings, and temporary screenshot storage.

## Decision

Use Docker Compose for the scraper and its Camoufox browser dependency. Deployments that need TLS termination or host-based routing can place any reverse proxy in front of the scraper service.

- `camofox-browser` stays on an internal Docker network.
- `videos/` is a named volume so recordings survive container restarts.
- Screenshot staging uses a tmpfs mount.
- `CAMOFOX_URL` defaults to the browser service name and can be overridden.

## Consequences

- Production ingress policy is deployment-specific; do not expose the browser-control service publicly.
- Secrets are supplied through an uncommitted environment file.
- The sibling Camoufox checkout preserves the tested Playwright compatibility pin.
