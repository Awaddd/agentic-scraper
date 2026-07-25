# ADR-0006: Use HMAC-SHA256 signed URLs for recording access

**Status:** Accepted

## Context

Recorded browser sessions need temporary access without adding a user-account database.

## Decision

When a job recording exists, generate an HMAC-SHA256 signature over `filename + ":" + expiryTimestamp` using `VIDEO_SECRET`. The service returns:

```text
GET /videos/:filename?token=<hex>&expiry=<unix-milliseconds>
```

The server validates the filename, expiry, and signature with `crypto.timingSafeEqual` before streaming the MP4.

## Consequences

- Access tokens are stateless and expire after 24 hours.
- Rotating `VIDEO_SECRET` invalidates outstanding recording URLs.
- Recordings are created only when the caller sets `record: true`.
