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

```bash
cp .env.example .env
npm install
npm run build
```

Required environment variables:

```env
OLLAMA_API_KEY=
VIDEO_SECRET=
```

Optional configuration:

```env
OLLAMA_BASE_URL=https://ollama.com/v1
CAMOFOX_URL=http://localhost:9377
MAX_STEPS=12
SCRAPER_WEBHOOK_SECRET=
PORT=3000
```

Start Camoufox in another terminal. Set `CAMOUFOX_HEADLESS=false` when you want to watch the browser work:

```bash
cd ../camofox-browser
CAMOUFOX_HEADLESS=false npm start
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

```bash
curl -X POST http://localhost:3000/scrape/jobs \
  -H 'Content-Type: application/json' \
  --data '{
    "url": "https://weworkremotely.com",
    "goal": "Find remote software-engineering roles. Return only real job listings with a title, company, and direct job URL.",
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
    "title": "Senior Infrastructure Software Engineer",
    "company": "Dropbox",
    "url": "https://weworkremotely.com/remote-jobs/dropbox-senior-infrastructure-software-engineer"
  },
  {
    "title": "Senior Software Engineer, Identity",
    "company": "Twilio",
    "url": "https://weworkremotely.com/remote-jobs/twilio-senior-software-engineer-identity"
  }
]
```

Add `"record": true` to the request only when an MP4 browser-session recording is useful. Recording is disabled by default.

Run the test suite with:

```bash
npm test
```

## Docker

The included Compose file starts the scraper and Camoufox browser service. Build it from this repository with its sibling `camofox-browser` checkout available:

```bash
docker compose build
docker compose up -d
```

`videos/` is stored in a named Docker volume. Temporary screenshots are stored in a container tmpfs.

## API

See the [API guide](docs/agent-guide.md) for request and webhook examples.

## Security and responsible use

- Credentials supplied to a job are held in memory only and are not written to disk or logs.
- Webhook payloads can be HMAC-signed with `SCRAPER_WEBHOOK_SECRET`.
- Recorded video URLs use expiring HMAC tokens.
- The service validates webhook schemes and video filenames before use.

Use this project only with websites and data you are authorised to access, and respect each site's terms and applicable law.

## Status

This project is evolving; issues and feedback are welcome.

## License

[MIT](LICENSE)
