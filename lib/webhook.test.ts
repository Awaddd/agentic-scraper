import { describe, it, expect } from "vitest";
import { createHmac } from "crypto";
import {
  isValidWebhookUrl,
  buildWebhookPayload,
  signWebhookHeaders,
  buildWebhookHeaders,
} from "./webhook.js";

describe("buildWebhookPayload", () => {
  it("builds the expected webhook payload for a completed job", () => {
    const payload = buildWebhookPayload({
      jobId: "abc123",
      type: "jobs",
      ok: true,
      result: [{ title: "Eng", company: "Acme", url: "https://example.com" }],
      tokens: { prompt: 100, completion: 50, total: 150 },
      steps: 3,
      durationMs: 12000,
    });

    expect(payload).toEqual({
      jobId: "abc123",
      type: "jobs",
      ok: true,
      result: [{ title: "Eng", company: "Acme", url: "https://example.com" }],
      tokens: { prompt: 100, completion: 50, total: 150 },
      steps: 3,
      durationMs: 12000,
    });
    expect(payload.videoUrl).toBeUndefined();
    expect(payload.error).toBeUndefined();
  });

  it("includes the error field when ok is false", () => {
    const payload = buildWebhookPayload({
      jobId: "xyz",
      type: "jobs",
      ok: false,
      result: null,
      tokens: { prompt: 80, completion: 20, total: 100 },
      steps: 12,
      durationMs: 45000,
      error: "Agent hit max steps without done",
    });

    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("Agent hit max steps without done");
    expect(payload.result).toBeNull();
    expect(payload.steps).toBe(12);
  });

  it("echoes the dispatch metadata object verbatim in the payload", () => {
    const metadata = { source_site: "wwr", category: "engineering", region: "EU" };
    const payload = buildWebhookPayload({
      jobId: "job-1",
      type: "jobs",
      ok: true,
      result: [],
      tokens: { prompt: 10, completion: 5, total: 15 },
      steps: 1,
      durationMs: 100,
      metadata,
    });

    expect(payload.metadata).toEqual(metadata);
  });

  it("omits the metadata key when the dispatch had no metadata", () => {
    const payload = buildWebhookPayload({
      jobId: "job-2",
      type: "jobs",
      ok: true,
      result: [],
      tokens: { prompt: 10, completion: 5, total: 15 },
      steps: 1,
      durationMs: 100,
    });

    expect(payload).not.toHaveProperty("metadata");
  });
});

describe("signWebhookHeaders", () => {
  it("adds X-Scraper-Signature and X-Scraper-Timestamp headers when SCRAPER_WEBHOOK_SECRET is set", () => {
    const headers = buildWebhookHeaders('{"jobId":"abc"}', "test-secret");

    expect(headers).toHaveProperty("X-Scraper-Signature");
    expect(headers).toHaveProperty("X-Scraper-Timestamp");
    // signature is a hex string
    expect(headers["X-Scraper-Signature"]).toMatch(/^[0-9a-f]+$/);
    // timestamp is a real ISO date
    expect(isNaN(Date.parse(headers["X-Scraper-Timestamp"]))).toBe(false);
  });

  it("sends no signature headers when SCRAPER_WEBHOOK_SECRET is unset", () => {
    const headers = buildWebhookHeaders('{"jobId":"abc"}', undefined);

    expect(headers).not.toHaveProperty("X-Scraper-Signature");
    expect(headers).not.toHaveProperty("X-Scraper-Timestamp");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("computes the signature over the exact raw body bytes", () => {
    const body = '{"jobId":"abc","ok":true,"result":[1,2,3]}';
    const secret = "test-secret";
    const headers = signWebhookHeaders(body, secret);

    const expected = createHmac("sha256", secret).update(body).digest("hex");
    expect(headers["X-Scraper-Signature"]).toBe(expected);
  });
});

describe("isValidWebhookUrl", () => {
  it("rejects a missing webhookUrl with 400", () => {
    expect(isValidWebhookUrl(undefined)).toBe(false);
    expect(isValidWebhookUrl(null)).toBe(false);
    expect(isValidWebhookUrl("")).toBe(false);
  });

  it("rejects a non-URL string as webhookUrl with 400", () => {
    expect(isValidWebhookUrl("not-a-url")).toBe(false);
    expect(isValidWebhookUrl("file:///etc/passwd")).toBe(false);
    expect(isValidWebhookUrl("javascript:alert(1)")).toBe(false);
  });
});
