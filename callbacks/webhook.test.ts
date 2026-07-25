import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
	buildWebhookHeaders,
	buildWebhookPayload,
	deliverWebhook,
} from "./webhook.js";

describe("webhook", () => {
	it("preserves exact payload bytes and signs those bytes", async () => {
		const payload = buildWebhookPayload({
			jobId: "a",
			type: "jobs",
			ok: true,
			result: [],
			tokens: { prompt: 1, completion: 2, total: 3 },
			steps: 1,
			durationMs: 4,
		});
		const body = JSON.stringify(payload);
		const timestamp = "2026-07-25T00:00:00.000Z";
		const headers = buildWebhookHeaders(body, "secret", timestamp);
		expect(headers["X-Scraper-Signature"]).toBe(
			createHmac("sha256", "secret")
				.update(`${timestamp}.${body}`)
				.digest("hex"),
		);
		const fetcher = vi
			.fn()
			.mockResolvedValue(new Response("", { status: 200 }));
		await deliverWebhook(
			"https://hook.test",
			payload,
			"secret",
			fetcher,
			1000,
			{ lookup: async () => ["93.184.216.34"] },
		);
		expect(fetcher.mock.calls[0]?.[1]?.body).toBe(body);
	});
	it("does not add optional signature headers without a secret", () =>
		expect(buildWebhookHeaders("{}", undefined)).toEqual({
			"Content-Type": "application/json",
		}));
	it("binds the timestamp to the raw body and blocks unsafe redirects", async () => {
		const body = '{"ok":true}';
		const timestamp = "2026-07-25T00:00:00.000Z";
		const signature = buildWebhookHeaders(body, "secret", timestamp)[
			"X-Scraper-Signature"
		];
		expect(signature).not.toBe(
			buildWebhookHeaders(body, "secret", "2026-07-25T00:00:01.000Z")[
				"X-Scraper-Signature"
			],
		);
		const fetcher = vi.fn().mockResolvedValue(
			new Response("", {
				status: 302,
				headers: { location: "http://127.0.0.1/" },
			}),
		);
		await expect(
			deliverWebhook("https://hook.test", {}, "secret", fetcher, 1000, {
				lookup: async () => ["93.184.216.34"],
			}),
		).rejects.toThrow();
		expect(fetcher).toHaveBeenCalledOnce();
	});
	it("aborts webhook delivery at its deadline", async () => {
		const fetcher = vi.fn(
			(_input: unknown, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
				}),
		);
		await expect(
			deliverWebhook("https://hook.test", {}, undefined, fetcher, 1, {
				lookup: async () => ["93.184.216.34"],
			}),
		).rejects.toMatchObject({ name: "TimeoutError" });
	});
});
