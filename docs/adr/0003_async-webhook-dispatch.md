# ADR-0003: Use asynchronous jobs with webhook delivery

**Status:** Accepted

## Context

Browser-agent runs can take seconds or minutes. Holding an HTTP request open ties callers to a fragile, long-lived connection.

## Decision

1. `POST /scrape/jobs` validates a request and immediately returns `202 Accepted` with a `jobId`.
2. The browser loop runs in the background.
3. The service posts the final success or failure payload to the request's `webhookUrl`.

The callback URL must be HTTP or HTTPS. Credentials supplied in a job are held in memory only for that run.

## Consequences

- Callers can dispatch multiple jobs without blocking.
- Callers should implement their own timeout and retry policy for missing callbacks.
- The `jobId` correlates the initial response with the final webhook payload.
