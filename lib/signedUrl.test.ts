import { describe, it, expect, beforeAll } from "vitest";
import { signVideoUrl, verifySignedUrl } from "./signedUrl.js";

beforeAll(() => {
  process.env.VIDEO_SECRET = "test-secret-for-unit-tests";
});

describe("signVideoUrl", () => {
  it("generates a signed URL containing the filename and a 24h expiry", () => {
    const query = signVideoUrl("job-abc.mp4");
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    const token = params.get("token");
    const expiry = params.get("expiry");

    expect(token).toBeTruthy();
    expect(expiry).toBeTruthy();

    const expiryMs = Number(expiry);
    const now = Date.now();
    expect(expiryMs).toBeGreaterThan(now + 86400_000 - 5_000);
    expect(expiryMs).toBeLessThan(now + 86400_000 + 5_000);
  });
});

describe("verifySignedUrl", () => {
  it("accepts a valid unexpired token for the correct filename", () => {
    const query = signVideoUrl("job-abc.mp4");
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    const token = params.get("token");
    const expiry = params.get("expiry");

    // If signVideoUrl doesn't produce a real token these will fail fast
    expect(token).toBeTruthy();
    expect(expiry).toBeTruthy();

    expect(verifySignedUrl("job-abc.mp4", token!, expiry!)).toBe(true);
  });

  it("rejects a missing, expired, or tampered token", () => {
    const query = signVideoUrl("job-abc.mp4");
    const params = new URLSearchParams(query.startsWith("?") ? query.slice(1) : query);
    const token = params.get("token")!;
    const expiry = params.get("expiry")!;

    // Expired (expiry in the past)
    expect(verifySignedUrl("job-abc.mp4", token, String(Date.now() - 1_000))).toBe(false);

    // Tampered token
    expect(verifySignedUrl("job-abc.mp4", token + "tampered", expiry)).toBe(false);

    // Wrong filename (HMAC won't match)
    expect(verifySignedUrl("other-file.mp4", token, expiry)).toBe(false);

    // Empty token
    expect(verifySignedUrl("job-abc.mp4", "", expiry)).toBe(false);
  });
});
