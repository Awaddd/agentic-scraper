import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { buildJobsConfig } from "./jobs/task.js";

function app(overrides: Partial<Parameters<typeof createApp>[0]> = {}) {
	return createApp({
		camofoxUrl: "http://camo",
		videoSecret: "secret",
		apiKey: "test-key",
		tasks: { jobs: buildJobsConfig },
		outboundPolicy: { lookup: async () => ["93.184.216.34"] },
		dispatch: vi.fn().mockResolvedValue(undefined),
		verifyVideo: vi.fn().mockReturnValue(true),
		fileExists: vi.fn().mockResolvedValue(undefined),
		openVideo: vi.fn().mockReturnValue(Readable.from(["video"])),
		fetcher: vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ browserConnected: true })),
			),
		createId: () => "job-1",
		...overrides,
	});
}
describe("Hono routes", () => {
	const auth = {
		Authorization: "Bearer test-key",
		"Content-Type": "application/json",
	};
	it("handles health success, wake, and failure", async () => {
		expect((await app().request("/health")).status).toBe(200);
		const wake = vi
			.fn()
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ browserConnected: false })),
			)
			.mockResolvedValueOnce(
				new Response(JSON.stringify({ browserConnected: true })),
			);
		expect((await app({ fetcher: wake }).request("/health")).status).toBe(200);
		expect(wake).toHaveBeenCalledTimes(2);
		expect(
			(
				await app({
					fetcher: vi.fn().mockRejectedValue(new Error("down")),
				}).request("/health")
			).status,
		).toBe(503);
	});
	it("aborts browser health at its configured deadline", async () => {
		const fetcher = vi.fn(
			(_input: unknown, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener("abort", () =>
						reject(new Error("aborted")),
					);
				}),
		);
		expect(
			(await app({ fetcher, camofoxTimeoutMs: 1 }).request("/health")).status,
		).toBe(503);
	});
	it("rejects unknown and invalid requests before dispatch", async () => {
		const dispatch = vi.fn();
		expect(
			(
				await app({ dispatch }).request("/scrape/nope", {
					method: "POST",
					headers: auth,
					body: "{}",
				})
			).status,
		).toBe(404);
		expect(
			(
				await app({ dispatch }).request("/scrape/toString", {
					method: "POST",
					headers: auth,
					body: "{}",
				})
			).status,
		).toBe(404);
		for (const body of [
			{},
			{ url: "", goal: "x", webhookUrl: "https://x.test" },
			{ url: "https://x", goal: "", webhookUrl: "https://x.test" },
			{ url: "https://x", goal: "x", webhookUrl: "ftp://x.test" },
			{
				url: "https://x",
				goal: "x",
				webhookUrl: "https://x.test",
				record: "yes",
			},
		])
			expect(
				(
					await app({ dispatch }).request("/scrape/jobs", {
						method: "POST",
						headers: auth,
						body: JSON.stringify(body),
					})
				).status,
			).toBe(400);
		expect(dispatch).not.toHaveBeenCalled();
	});
	it("accepts a valid job immediately", async () => {
		const dispatch = vi.fn().mockResolvedValue(undefined);
		const response = await app({ dispatch }).request("/scrape/jobs", {
			method: "POST",
			headers: auth,
			body: JSON.stringify({
				url: "https://x.test",
				goal: "find",
				webhookUrl: "https://hook.test",
			}),
		});
		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({ jobId: "job-1" });
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ jobId: "job-1" }),
		);
	});
	it("requires bearer authentication and rejects removed fields", async () => {
		const valid = {
			url: "https://x.test",
			goal: "find",
			webhookUrl: "https://hook.test",
		};
		expect(
			(
				await app().request("/scrape/jobs", {
					method: "POST",
					body: JSON.stringify(valid),
				})
			).status,
		).toBe(401);
		for (const extra of [
			{ sessionKey: "x" },
			{ credentials: { cookie: "x" } },
		]) {
			expect(
				(
					await app().request("/scrape/jobs", {
						method: "POST",
						headers: auth,
						body: JSON.stringify({ ...valid, ...extra }),
					})
				).status,
			).toBe(400);
		}
	});
	it("authorizes, detects a missing video, and streams an existing video", async () => {
		expect(
			(await app({ verifyVideo: () => false }).request("/videos/a.mp4")).status,
		).toBe(401);
		expect(
			(
				await app({
					fileExists: vi.fn().mockRejectedValue(new Error("missing")),
				}).request("/videos/a.mp4?token=x&expiry=y")
			).status,
		).toBe(404);
		const response = await app().request("/videos/a.mp4?token=x&expiry=y");
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("video/mp4");
		expect(await response.text()).toBe("video");
	});
});
