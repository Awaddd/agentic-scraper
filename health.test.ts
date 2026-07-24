import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// server.ts calls serve() at module load and throws without VIDEO_SECRET.
// Mock serve to a no-op and set the env before dynamically importing.
vi.mock("@hono/node-server", () => ({ serve: () => {} }));

const CAMOFOX_URL = "http://camofox-test:9999";

async function importServer() {
  vi.resetModules();
  process.env.VIDEO_SECRET = "test";
  process.env.CAMOFOX_URL = CAMOFOX_URL;
  delete process.env.SCRAPER_WEBHOOK_SECRET;
  return import("./server.js");
}

function stubCamofoxHealth(responses: Array<{ browserConnected: boolean }>) {
  const calls: string[] = [];
  let idx = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    calls.push(u);
    if (u.includes("/health")) {
      const r = responses[Math.min(idx, responses.length - 1)];
      idx++;
      return new Response(JSON.stringify(r), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return {
    healthCalls: () => calls.filter((c) => c.includes("/health")).length,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

describe("/health", () => {
  let stub: ReturnType<typeof stubCamofoxHealth>;
  let app: Awaited<ReturnType<typeof importServer>>["app"];

  beforeEach(async () => {
    const mod = await importServer();
    app = mod.app;
  });
  afterEach(() => stub?.restore());

  it("lazy-relaunches the camofox browser on /health when it is not running", async () => {
    // first poll: browser down; the wake (lazy relaunch) brings it back up
    stub = stubCamofoxHealth([{ browserConnected: false }, { browserConnected: true }]);

    const res = await app.request("/health");
    const body = (await res.json()) as { ok: boolean; browserConnected: boolean };

    expect(body.browserConnected).toBe(true);
    expect(body.ok).toBe(true);
    // a wake was triggered (more than one camofox /health call)
    expect(stub.healthCalls()).toBeGreaterThan(1);
  });
});