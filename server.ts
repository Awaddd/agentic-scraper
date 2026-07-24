import { serve } from "@hono/node-server";
import { Hono } from "hono";
import pino from "pino";
import { randomUUID } from "crypto";
import { createReadStream } from "fs";
import { isValidWebhookUrl, buildWebhookPayload, buildWebhookHeaders } from "./lib/webhook.js";
import { runAgent } from "./agent.js";
import { verifySignedUrl } from "./lib/signedUrl.js";
import { buildJobsConfig } from "./tasks/jobs.js";

if (!process.env.VIDEO_SECRET) {
  throw new Error("VIDEO_SECRET env var is required");
}

const CAMOFOX_URL = process.env.CAMOFOX_URL ?? "http://camofox-browser:9377";
const PORT = Number(process.env.PORT ?? 3000);

const logger = pino({ level: "info" });

export interface AgentJob {
  jobId: string;
  type: string;
  url: string;
  goal: string;
  webhookUrl: string;
  context?: Record<string, unknown>;
  sessionKey?: string;
  model?: string;
  record?: boolean;
  credentials?: { cookie?: string };
  metadata?: Record<string, unknown>;
}

type TaskBuilder = (job: AgentJob) => {
  systemPrompt: string;
  processResult: (act: Record<string, unknown>) => unknown;
};

const TASK_HANDLERS: Record<string, TaskBuilder> = {
  jobs: buildJobsConfig,
};

const app = new Hono();

app.get("/health", async (c) => {
  try {
    const res = await fetch(`${CAMOFOX_URL}/health`);
    const body = (await res.json()) as { browserConnected?: boolean };
    let connected = body.browserConnected === true;

    if (!connected) {
      // Lazy relaunch: camofox's /health endpoint wakes the browser on demand
      const wakeRes = await fetch(`${CAMOFOX_URL}/health`);
      const wakeBody = (await wakeRes.json()) as { browserConnected?: boolean };
      connected = wakeBody.browserConnected === true;
    }

    return c.json({ ok: connected, browserConnected: connected }, connected ? 200 : 503);
  } catch {
    return c.json({ ok: false, browserConnected: false }, 503);
  }
});

app.post("/scrape/:type", async (c) => {
  const type = c.req.param("type");

  if (!(type in TASK_HANDLERS)) {
    return c.json({ error: `Unknown task type: ${type}` }, 404);
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  if (!isValidWebhookUrl(body.webhookUrl)) {
    return c.json({ error: "webhookUrl must be a valid http/https URL" }, 400);
  }

  const jobId = randomUUID();
  const job: AgentJob = {
    jobId,
    type,
    url: body.url as string,
    goal: body.goal as string,
    webhookUrl: body.webhookUrl as string,
    context: body.context as Record<string, unknown> | undefined,
    sessionKey: body.sessionKey as string | undefined,
    model: body.model as string | undefined,
    record: body.record as boolean | undefined,
    // credentials are used in-memory only, never logged or written to disk
    credentials: body.credentials as { cookie?: string } | undefined,
    metadata: body.metadata as Record<string, unknown> | undefined,
  };

  // Dispatch in background — do not await
  void dispatchJob(job, type);

  return c.json({ jobId }, 202);
});

app.get("/videos/:filename", async (c) => {
  const filename = c.req.param("filename");

  // Reject filenames that could be path traversal
  if (!/^[a-zA-Z0-9_-]+\.mp4$/.test(filename)) {
    return c.json({ error: "Invalid filename" }, 400);
  }

  const token = c.req.query("token") ?? "";
  const expiry = c.req.query("expiry") ?? "";

  if (!verifySignedUrl(filename, token, expiry)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const filePath = `videos/${filename}`;
  try {
    const stream = createReadStream(filePath);
    return new Response(stream as unknown as ReadableStream, {
      headers: { "Content-Type": "video/mp4" },
    });
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
});

async function dispatchJob(job: AgentJob, type: string): Promise<void> {
  const handler = TASK_HANDLERS[type]!;
  try {
    let result: unknown = null;
    let tokens = { prompt: 0, completion: 0, total: 0 };
    let steps = 0;
    let videoUrl: string | undefined;

    const taskConfig = handler(job);
    const agentResult = await runAgent(job, taskConfig);
    result = agentResult.result;
    tokens = agentResult.tokens;
    steps = agentResult.steps;
    videoUrl = agentResult.videoUrl;

    const payload = buildWebhookPayload({ jobId: job.jobId, type, ok: true, result, tokens, steps, durationMs: agentResult.durationMs, videoUrl, metadata: job.metadata });
    await fireWebhook(job.webhookUrl, payload);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    logger.error({ jobId: job.jobId, error }, "job failed");
    const payload = buildWebhookPayload({
      jobId: job.jobId,
      type,
      ok: false,
      result: null,
      tokens: { prompt: 0, completion: 0, total: 0 },
      steps: 0,
      durationMs: 0,
      error,
      metadata: job.metadata,
    });
    await fireWebhook(job.webhookUrl, payload).catch((e) =>
      logger.error({ jobId: job.jobId, err: e }, "webhook delivery failed"),
    );
  }
}

async function fireWebhook(url: string, payload: unknown): Promise<void> {
  const body = JSON.stringify(payload);
  const headers = buildWebhookHeaders(body, process.env.SCRAPER_WEBHOOK_SECRET);
  const res = await fetch(url, {
    method: "POST",
    headers,
    body,
  });
  if (!res.ok) {
    // A callback URL may be sensitive deployment information. Log status only.
    logger.warn({ status: res.status }, "webhook returned non-2xx");
  }
}

export { app, TASK_HANDLERS };

serve({ fetch: app.fetch, port: PORT }, () => {
  logger.info({ port: PORT }, "agentic scraper started");
});
