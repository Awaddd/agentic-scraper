import { describe, expect, it } from "vitest";
import { signVideoUrl, verifySignedUrl } from "./signed-url.js";

describe("signed URLs", () => {
	it("uses a 24 hour millisecond expiry", () => {
		const query = signVideoUrl("a.mp4", "s", 100);
		const parameters = new URLSearchParams(query.slice(1));
		const expiry = parameters.get("expiry");
		const token = parameters.get("token");

		if (!expiry || !token) {
			throw new Error("signed URL must include a token and expiry");
		}

		expect(expiry).toBe("86400100");
		expect(verifySignedUrl("a.mp4", token, expiry, "s", 101)).toBe(true);
	});
});
