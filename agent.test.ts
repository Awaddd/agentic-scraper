import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// agent.ts reads CAMOFOX_URL at module load; set it before the dynamic import.
const CAMOFOX_URL = "http://camofox-test:9999";

async function importAgent() {
  vi.resetModules();
  process.env.CAMOFOX_URL = CAMOFOX_URL;
  return import("./agent.js");
}

// Mirrors the real camo() /tabs POST shape — non-ok throws with the status in
// the message (this is the contract createTabWithRetry inspects to decide retry).
async function createTab(url: string, sessionKey: string): Promise<{ id: string }> {
  const res = await fetch(`${CAMOFOX_URL}/tabs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: "u", sessionKey, url }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`camo POST /tabs -> ${res.status}: ${text}`);
  return JSON.parse(text) as { id: string };
}

function stubFetch(routes: {
  tabsStatus?: number[];
  tabsBody?: unknown;
  health?: { status: number; body: unknown };
}) {
  const calls: string[] = [];
  let tabIdx = 0;
  const tabsStatus = routes.tabsStatus ?? [200];
  const tabsBody = routes.tabsBody ?? { id: "tab-1" };
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = typeof input === "string" ? input : input.toString();
    calls.push(`${init?.method ?? "GET"} ${u}`);
    if (u.includes("/tabs")) {
      const status = tabsStatus[Math.min(tabIdx, tabsStatus.length - 1)];
      tabIdx++;
      return new Response(status === 200 ? JSON.stringify(tabsBody) : "session expired", {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/health")) {
      return new Response(JSON.stringify(routes.health?.body ?? { browserConnected: true }), {
        status: routes.health?.status ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("{}", { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  return {
    calls,
    countPath: (path: string) => calls.filter((c) => c.includes(path)).length,
    restore: () => {
      globalThis.fetch = realFetch;
    },
  };
}

describe("buildStepUserMessage", () => {
  it("does not include dispatch metadata in the LLM user message", async () => {
    const { buildStepUserMessage } = await importAgent();
    const message = buildStepUserMessage({
      goal: "Find engineering jobs",
      snapshot: "<accessibility-tree>link Apply</accessibility-tree>",
      context: { profile: "senior" },
    });

    // goal + snapshot + context are intentionally prompt-injected
    expect(message).toContain("Find engineering jobs");
    expect(message).toContain("<accessibility-tree>");
    expect(message).toContain("profile");

    // metadata is a return label, NOT prompt-injected — it must not appear
    expect(message).not.toContain("source_site");
    expect(message).not.toContain("category");
  });
});

describe("createTabWithRetry", () => {
  let stub: ReturnType<typeof stubFetch>;
  let mod: Awaited<ReturnType<typeof importAgent>>;

  beforeEach(async () => {
    stub = stubFetch({});
    mod = await importAgent();
  });
  afterEach(() => stub.restore());

  it("wakes the browser and retries tab creation on session_expired, up to 3 attempts", async () => {
    stub.restore();
    stub = stubFetch({ tabsStatus: [503, 503, 200], tabsBody: { id: "tab-99" } });

    const tab = await mod.createTabWithRetry(createTab, "https://example.com", "sess-1");

    expect(tab.id).toBe("tab-99");
    expect(stub.countPath("/tabs")).toBe(3); // retried up to 3 attempts
    // a wake was triggered between retries — wakeBrowser GETs camofox /health,
    // observed here as a /health fetch (ESM internal-call spy is unreliable).
    expect(stub.countPath("/health")).toBeGreaterThanOrEqual(1);
  });

  it("fails the job after 3 failed wake+retry attempts instead of hanging", async () => {
    stub.restore();
    stub = stubFetch({ tabsStatus: [503, 503, 503] });

    await expect(
      mod.createTabWithRetry(createTab, "https://example.com", "sess-2"),
    ).rejects.toThrow();

    expect(stub.countPath("/tabs")).toBe(3); // bounded: exactly 3 attempts, not infinite
  });
});