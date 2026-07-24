# agentic-scraper

An LLM-driven browser agent for extracting structured job listings from authorised public websites.

Give the service a starting URL, a natural-language goal, and a webhook callback. It drives a real Firefox browser through accessibility snapshots, returns normalised listing data asynchronously, and can record the browser session for review.

## What it does

1. Accepts `POST /scrape/jobs` and immediately returns a job ID.
2. Opens a browser tab and gives the LLM an accessibility snapshot of the page.
3. Repeats a bounded click, type, scroll, or navigate loop until the agent completes.
4. Posts normalised job listings to the supplied webhook URL.
5. Optionally turns per-step screenshots into a signed MP4 recording.

The current public task is deliberately narrow: job-listing extraction. The agent filters ads, sponsored placements, tracking URLs, and incomplete listing data before returning results.

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
npm start
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

This is a curated public extract of an actively used private project. It is useful as a reference implementation and is still evolving; issues and feedback are welcome.

## License

[MIT](LICENSE)
