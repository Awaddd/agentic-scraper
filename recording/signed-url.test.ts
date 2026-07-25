import { describe, expect, it } from "vitest";
import { signVideoUrl, verifySignedUrl } from "./signed-url.js";
describe("signed URLs", () => { it("uses a 24 hour millisecond expiry", () => { const query = signVideoUrl("a.mp4", "s", 100); const expiry = new URLSearchParams(query.slice(1)).get("expiry")!; expect(expiry).toBe("86400100"); expect(verifySignedUrl("a.mp4", new URLSearchParams(query.slice(1)).get("token")!, expiry, "s", 101)).toBe(true); }); });
