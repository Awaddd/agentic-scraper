# agentic-scraper

An agentic structured web-research and data-extraction service for authorised public websites.

Give the service a starting URL, a natural-language goal, and a webhook callback. It researches pages through browser accessibility snapshots, returns structured data asynchronously, and can record the browser session for review.

## What it does

1. Accepts `POST /scrape/jobs` and immediately returns a job ID.
2. Opens a browser tab and gives the LLM an accessibility snapshot of the page.
3. Repeats a bounded click, type, scroll, or navigate loop until the agent completes.
4. Posts the task's structured result to the supplied webhook URL.
5. Can optionally turn per-step screenshots into a signed MP4 recording.

The public extract includes a job-listing task as a reference implementation. Its task-specific filtering of ads, sponsored placements, tracking URLs, and incomplete listing data is documented in the architecture and task modules for contributors. Additional task types can define their own prompt and result projection.

## Architecture

```text
client → POST /scrape/jobs → agentic-scraper → Camoufox / Firefox
                               ↓
                         OpenAI-compatible LLM
                               ↓
                         signed webhook callback
```

## Stack

- Node.js 22 + TypeScript
- Hono HTTP server
- Camoufox / Firefox browser control over REST
- Any OpenAI-compatible chat-completions endpoint
- Pino logging, Vitest, Docker, and ffmpeg recordings

## Local development

This project expects a compatible `camofox-browser` checkout beside it:

```text
Projects/
  camofox-browser/
  agentic-scraper/
```

From the `agentic-scraper` directory, bootstrap the pinned browser checkout once:

```bash
./scripts/install-camofox-browser.sh
```

The bootstrap applies the required patches, pins `camoufox-js` to `0.10.2`, and downloads Camoufox `135.0.1-beta.24` for macOS or Linux. It is safe to rerun. The browser bundle stays in ignored local state for this checkout.

```bash
cp .env.example .env
npm install
npm run build
```

Required environment variables:

```env
OLLAMA_API_KEY=
VIDEO_SECRET=
SCRAPER_API_KEY=
```

Optional configuration:

```env
OLLAMA_BASE_URL=https://ollama.com/v1
CAMOFOX_URL=http://localhost:9377
MAX_STEPS=12
SCRAPER_WEBHOOK_SECRET=
SCRAPER_ALLOW_INSECURE_LOCAL=false
SCRAPER_HOST=127.0.0.1
MODEL_TIMEOUT_MS=30000
CAMOFOX_TIMEOUT_MS=20000
WEBHOOK_TIMEOUT_MS=10000
PORT=3000
```

Start Camoufox in another terminal. Set `CAMOUFOX_HEADLESS=false` when you want to watch the browser work:

```bash
CAMOUFOX_HEADLESS=false ./scripts/start-camofox-browser.sh
```

Start the scraper:

```bash
npm start
```

Confirm that the browser service is connected:

```bash
curl http://localhost:3000/health
```

For a local end-to-end test, start the included callback receiver in a separate terminal:

```bash
node webhook-listener.mjs
```

Then dispatch a job:

For this loopback callback example only, set `SCRAPER_ALLOW_INSECURE_LOCAL=true` and keep `SCRAPER_HOST=127.0.0.1`; production remains public-only.

```bash
curl -X POST http://localhost:3000/scrape/jobs \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer replace-with-your-scraper-api-key' \
  --data '{
    "url": "https://weworkremotely.com",
    "goal": "Find exactly two remote product-design roles. Return only real job listings with a title, company, and direct job URL.",
    "webhookUrl": "http://localhost:4000",
    "model": "glm-5.2"
  }'
```

The request is asynchronous and immediately returns a job ID:

```json
{ "jobId": "a3d4f6bc-0000-4000-8000-000000000000" }
```

The callback receiver then prints the completed result. A representative result looks like:

```json
[
  {
    "title": "Senior Staff Product Designer, Risk",
    "company": "Stripe",
    "url": "https://weworkremotely.com/remote-jobs/stripe-senior-staff-product-designer-risk"
  },
  {
    "title": "Lead Product Designer",
    "company": "Twilio",
    "url": "https://weworkremotely.com/remote-jobs/twilio-lead-product-designer"
  }
]
```

Add `"record": true` to the request only when an MP4 browser-session recording is useful. Recording is disabled by default.

Run the test suite with:

```bash
npm test
```

## Docker

The included Compose file starts the scraper and its pinned Camoufox browser service. Use the wrapper so the sibling is a clean detached checkout, the patch set is validated before application, and the browser artifacts use an explicit architecture:

```bash
./scripts/build-compose.sh x86_64 # or aarch64; builds and starts the stack
```

`videos/` is stored in a named Docker volume. Temporary screenshots are stored in a container tmpfs.

## API

See the [API guide](docs/agent-guide.md) for request and webhook examples.

## Security and responsible use

- `POST /scrape/:type` requires `Authorization: Bearer <SCRAPER_API_KEY>`; the explicit loopback-only local bypass permits an unset key, but a supplied key remains enforced. `/health` remains public and signed video URLs remain token-protected.
- Starting URLs, browser navigation, webhook delivery, and projected listing URLs use a DNS-aware public-outbound policy. `SCRAPER_ALLOW_INSECURE_LOCAL=true` is an explicit loopback-only development exception and requires a loopback `SCRAPER_HOST`.
- Webhook payloads can be HMAC-signed with `SCRAPER_WEBHOOK_SECRET` over `<timestamp>.<rawBody>`.
- Recorded video URLs use expiring HMAC tokens.
- Production deployments must enforce network egress filtering as defence in depth. The application-level policy is not a replacement for network controls.

Use this project only with websites and data you are authorised to access, and respect each site's terms and applicable law.

## Status

This project is evolving; issues and feedback are welcome.

## License

[MIT](LICENSE)
