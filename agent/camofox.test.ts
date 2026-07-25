import { describe, expect, it, vi } from "vitest";
import { createCamofox, createTabWithRetry } from "./camofox.js";

describe("camofox retry", () => {
	it("wakes and retries at most three times", async () => {
		const create = vi
			.fn()
			.mockRejectedValueOnce(new Error("503"))
			.mockRejectedValueOnce(new Error("session_expired"))
			.mockResolvedValue({ id: "a" });
		const wake = vi.fn();
		const sleep = vi.fn().mockResolvedValue(undefined);
		await expect(
			createTabWithRetry(create, "https://x", "s", wake, { sleep }),
		).resolves.toEqual({ id: "a" });
		expect(create).toHaveBeenCalledTimes(3);
		expect(wake).toHaveBeenCalledTimes(2);
		expect(sleep).toHaveBeenNthCalledWith(1, 250);
		expect(sleep).toHaveBeenNthCalledWith(2, 500);
	});
	it("enforces the policy before creating or navigating tabs", async () => {
		const fetcher = vi.fn();
		const tabs = createCamofox("http://camo", "user", fetcher, {
			outboundPolicy: { lookup: async () => ["127.0.0.1"] },
		});
		await expect(tabs.create("http://localhost", "s")).rejects.toThrow();
		await expect(tabs.navigate("tab", "http://localhost")).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
	});
	it("aborts a Camoufox request at its configured deadline", async () => {
		const fetcher = vi.fn(
			(_input: unknown, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
				}),
		);
		const tabs = createCamofox("http://camo", "user", fetcher, {
			timeoutMs: 1,
		});
		await expect(tabs.snapshot("tab")).rejects.toMatchObject({
			name: "TimeoutError",
		});
	});
});
