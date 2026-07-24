# API guide

## Dispatch a job

```text
POST /scrape/jobs
```

The service responds immediately with `202 Accepted`, then posts the final result to `webhookUrl`.

```json
{
  "url": "https://example.com/jobs",
  "goal": "Find remote software-engineering roles. Use search if available and skip ads or sponsored listings.",
  "webhookUrl": "https://your-service.example/webhooks/agentic-scraper",
  "model": "glm-5.2",
  "record": false,
  "metadata": {
    "source": "example-jobs"
  }
}
```

| Field | Required | Description |
| --- | --- | --- |
| `url` | yes | Starting page for the browser session. |
| `goal` | yes | Natural-language extraction goal. |
| `webhookUrl` | yes | HTTP or HTTPS endpoint that receives the completed job. |
| `model` | no | OpenAI-compatible model override. |
| `record` | no | Capture a browser-session MP4. |
| `context` | no | JSON context made available to the agent. |
| `metadata` | no | Opaque metadata echoed in the webhook payload; it is not added to the agent prompt. |
| `sessionKey` | no | Reuse a browser session when your authorised workflow requires it. |
| `credentials` | no | `{ "cookie": "..." }`, held in memory only. |

Successful dispatch:

```json
{ "jobId": "a3d4f6bc-0000-4000-8000-000000000000" }
```

## Webhook result

On success, the service posts:

```json
{
  "jobId": "a3d4f6bc-0000-4000-8000-000000000000",
  "type": "jobs",
  "ok": true,
  "result": [
    {
      "title": "Senior Software Engineer",
      "company": "Example Co.",
      "url": "https://example.com/jobs/123"
    }
  ],
  "tokens": { "prompt": 1200, "completion": 240, "total": 1440 },
  "steps": 3,
  "durationMs": 12000,
  "metadata": { "source": "example-jobs" }
}
```

When `record` is enabled and video generation succeeds, the payload also includes an expiring `videoUrl`.

Failures use the same shape with `ok: false`, `result: null`, and an `error` field.

## Webhook signatures

When `SCRAPER_WEBHOOK_SECRET` is configured, callbacks include:

```text
X-Scraper-Signature: <HMAC-SHA256 of the raw request body>
X-Scraper-Timestamp: <ISO-8601 timestamp>
```

Verify the signature against the exact raw request bytes before parsing JSON, and reject stale timestamps to defend against replay.

## Health check

```text
GET /health
```

Returns `200` when the browser service is connected:

```json
{ "ok": true, "browserConnected": true }
```

Returns `503` when the browser cannot be reached.
