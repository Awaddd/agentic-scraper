# ADR-0001: Browser automation via Camoufox + camofox-browser REST API

**Status:** Accepted

## Context

The agent needs reliable control of a real browser through a small, self-hosted HTTP interface. Camoufox provides a Firefox-based browser runtime and `camofox-browser` provides the REST API the agent loop consumes.

## Decision

Use **Camoufox** (Firefox fork) via the **camofox-browser** REST API server (`@askjo/camofox-browser`). The scraper calls it over HTTP — no Playwright SDK dependency in the scraper itself. camofox-browser runs as a sibling service.

## Constraints

- `playwright-core` must be pinned to **1.60.0** in the camofox-browser package. Playwright 1.61+ sends `isMobile` in `Browser.setDefaultViewport`; Camoufox's Juggler layer rejects it with a 500. We build camofox-browser from a local clone with this pin applied (`../camofox-browser`).
- camofox-browser is headless on Linux (reads Xvfb env); the `CAMOUFOX_HEADLESS=false` patch on the local clone enables headed mode on macOS for local development.

## Consequences

- Self-hosted: no per-request cloud cost for the browser layer.
- The agent loop is isolated from browser-vendor APIs behind a small REST surface.
- We own the camofox-browser clone and must pull upstream updates manually.
- The scraper has no direct Playwright dependency; all browser control is HTTP calls to `CAMOFOX_URL`.
