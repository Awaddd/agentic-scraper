import { createHmac } from "node:crypto";

export function isValidWebhookUrl(url: unknown): boolean {
  if (typeof url !== "string" || url === "") return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function buildWebhookPayload(fields: {
  jobId: string;
  type: string;
  ok: boolean;
  result: unknown;
  tokens: { prompt: number; completion: number; total: number };
  steps: number;
  durationMs: number;
  videoUrl?: string;
  error?: string;
  metadata?: Record<string, unknown>;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    jobId: fields.jobId,
    type: fields.type,
    ok: fields.ok,
    result: fields.result,
    tokens: fields.tokens,
    steps: fields.steps,
    durationMs: fields.durationMs,
  };

  if (fields.videoUrl !== undefined) {
    payload.videoUrl = fields.videoUrl;
  }

  if (fields.error !== undefined) {
    payload.error = fields.error;
  }

  if (fields.metadata !== undefined) {
    payload.metadata = fields.metadata;
  }

  return payload;
}

export function signWebhookHeaders(body: string, secret: string): Record<string, string> {
  const signature = createHmac("sha256", secret).update(body).digest("hex");
  return {
    "X-Scraper-Signature": signature,
    "X-Scraper-Timestamp": new Date().toISOString(),
  };
}

export function buildWebhookHeaders(body: string, secret: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (secret) {
    Object.assign(headers, signWebhookHeaders(body, secret));
  }

  return headers;
}
