import { mkdir } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { Tabs } from "./camofox.js";
import { sleep as realSleep, runAgent } from "./run.js";

vi.mock("node:fs/promises", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs/promises")>();
	return { ...actual, mkdir: vi.fn(actual.mkdir) };
});

const job = {
	jobId: "run-test",
	type: "jobs",
	url: "https://x.test",
	goal: "find",
	webhookUrl: "https://hook.test",
	metadata: { private: "metadata" },
};
function tabs(): Tabs {
	return {
		create: vi.fn().mockResolvedValue({ id: "tab" }),
		snapshot: vi.fn().mockResolvedValue({ snapshot: "page" }),
		click: vi.fn().mockResolvedValue({}),
		type: vi.fn().mockResolvedValue({}),
		scroll: vi.fn().mockResolvedValue({}),
		navigate: vi.fn().mockResolvedValue({}),
		close: vi.fn().mockResolvedValue({}),
	};
}
describe("agent loop", () => {
	it("runs multiple steps, compresses snapshots, totals tokens, and closes", async () => {
		const transport = tabs();
		const model = {
			complete: vi
				.fn()
				.mockResolvedValueOnce({
					content: '{"action":"scroll"}',
					usage: { prompt_tokens: 2, completion_tokens: 3 },
				})
				.mockResolvedValueOnce({
					content: '{"action":"done","listings":[]}',
					usage: { prompt_tokens: 4, completion_tokens: 5 },
				}),
		};
		const result = await runAgent(
			job,
			{ systemPrompt: "system", processResult: () => [] },
			{
				model,
				createTabs: () => transport,
				camofoxUrl: "http://c",
				maxSteps: 3,
				videoSecret: "s",
				wakeBrowser: vi.fn(),
			},
		);
		expect(result).toMatchObject({
			steps: 2,
			tokens: { prompt: 6, completion: 8, total: 14 },
		});
		expect(transport.close).toHaveBeenCalled();
		const second = model.complete.mock.calls[1]?.[0];
		expect(second[1].content).toBe("[step 1 snapshot — compressed]");
		expect(JSON.stringify(model.complete.mock.calls)).not.toContain("metadata");
	});
	it("waits 1.5 seconds after an action before recording a frame", async () => {
		const transport = tabs();
		const capture = vi.fn().mockResolvedValue(undefined);
		let releaseSleep: (() => void) | undefined;
		const sleep = vi.fn(
			() =>
				new Promise<void>((resolve) => {
					releaseSleep = resolve;
				}),
		);
		const execution = runAgent(
			{ ...job, record: true },
			{ systemPrompt: "s", processResult: () => [] },
			{
				model: {
					complete: vi
						.fn()
						.mockResolvedValueOnce({
							content: '{"action":"scroll"}',
							usage: { prompt_tokens: 0, completion_tokens: 0 },
						})
						.mockResolvedValueOnce({
							content: '{"action":"done"}',
							usage: { prompt_tokens: 0, completion_tokens: 0 },
						}),
				},
				createTabs: () => transport,
				camofoxUrl: "http://c",
				maxSteps: 2,
				videoSecret: "s",
				wakeBrowser: vi.fn(),
				sleep,
				capture,
				stitch: vi.fn().mockResolvedValue(false),
			},
		);
		await vi.waitFor(() => expect(sleep).toHaveBeenCalledWith(1500));
		expect(capture).not.toHaveBeenCalled();
		releaseSleep?.();
		await execution;
		expect(capture).toHaveBeenCalledOnce();
	});
	it("keeps a completed scrape successful when recording does not produce a video", async () => {
		const transport = tabs();
		const logger = { warn: vi.fn() };
		const result = await runAgent(
			{ ...job, record: true },
			{ systemPrompt: "s", processResult: () => [{ title: "result" }] },
			{
				model: {
					complete: vi.fn().mockResolvedValue({
						content: '{"action":"done"}',
						usage: { prompt_tokens: 0, completion_tokens: 0 },
					}),
				},
				createTabs: () => transport,
				camofoxUrl: "http://c",
				maxSteps: 1,
				videoSecret: "s",
				wakeBrowser: vi.fn(),
				stitch: vi.fn().mockResolvedValue(false),
				logger,
			},
		);

		expect(result).toMatchObject({ ok: true, result: [{ title: "result" }] });
		expect(result).not.toHaveProperty("videoUrl");
		expect(transport.close).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith(
			{ jobId: "run-test" },
			"recording stitch did not produce video",
		);
	});
	it("bounds injected recording finalization and still closes a successful scrape", async () => {
		const transport = tabs();
		const logger = { warn: vi.fn() };
		const result = await runAgent(
			{ ...job, record: true },
			{ systemPrompt: "s", processResult: () => [] },
			{
				model: {
					complete: vi.fn().mockResolvedValue({
						content: '{"action":"done"}',
						usage: { prompt_tokens: 0, completion_tokens: 0 },
					}),
				},
				createTabs: () => transport,
				camofoxUrl: "http://c",
				maxSteps: 1,
				videoSecret: "s",
				wakeBrowser: vi.fn(),
				stitch: () => new Promise<boolean>(() => undefined),
				recordingTimeoutMs: 1,
				logger,
			},
		);

		expect(result).toMatchObject({ ok: true, result: [] });
		expect(result).not.toHaveProperty("videoUrl");
		expect(transport.close).toHaveBeenCalledOnce();
		expect(logger.warn).toHaveBeenCalledWith(
			{ jobId: "run-test" },
			"recording finalization timed out",
		);
	});
	it("keeps the real sleep pending until 1.5 seconds have elapsed", async () => {
		vi.useFakeTimers();
		try {
			let settled = false;
			const pending = realSleep(1500).then(() => {
				settled = true;
			});
			await vi.advanceTimersByTimeAsync(1499);
			expect(settled).toBe(false);
			await vi.advanceTimersByTimeAsync(1);
			await pending;
			expect(settled).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
	it("cleans up on a failed action transport", async () => {
		const transport = tabs();
		(transport.snapshot as ReturnType<typeof vi.fn>).mockRejectedValue(
			new Error("broken"),
		);
		await expect(
			runAgent(
				job,
				{ systemPrompt: "s", processResult: () => [] },
				{
					model: { complete: vi.fn() },
					createTabs: () => transport,
					camofoxUrl: "http://c",
					maxSteps: 1,
					videoSecret: "s",
					wakeBrowser: vi.fn(),
				},
			),
		).resolves.toMatchObject({
			ok: false,
			error: "browser or model operation failed",
		});
		expect(transport.close).toHaveBeenCalled();
	});
	it("returns a safe failure for invalid action schemas", async () => {
		const logger = { warn: vi.fn() };
		const result = await runAgent(
			job,
			{ systemPrompt: "s", processResult: () => [] },
			{
				model: {
					complete: vi.fn().mockResolvedValue({
						content: '{"action":"unsupported"}',
						usage: { prompt_tokens: 1, completion_tokens: 2 },
					}),
				},
				createTabs: tabs,
				camofoxUrl: "http://c",
				maxSteps: 1,
				videoSecret: "s",
				wakeBrowser: vi.fn(),
				logger,
			},
		);

		expect(result).toMatchObject({
			ok: false,
			result: null,
			steps: 1,
			tokens: { prompt: 1, completion: 2, total: 3 },
		});
		expect(logger.warn).toHaveBeenCalledWith(
			{ jobId: "run-test", issueCount: expect.any(Number) },
			"action failed schema validation",
		);
	});
	it("returns a completed scrape when result-artifact directory creation fails", async () => {
		vi.mocked(mkdir).mockRejectedValueOnce(new Error("results unavailable"));
		const transport = tabs();
		const logger = { warn: vi.fn() };

		const result = await runAgent(
			job,
			{ systemPrompt: "s", processResult: () => [{ title: "result" }] },
			{
				model: {
					complete: vi.fn().mockResolvedValue({
						content: '{"action":"done"}',
						usage: { prompt_tokens: 0, completion_tokens: 0 },
					}),
				},
				createTabs: () => transport,
				camofoxUrl: "http://c",
				maxSteps: 1,
				videoSecret: "s",
				wakeBrowser: vi.fn(),
				logger,
			},
		);

		expect(result).toMatchObject({ ok: true, result: [{ title: "result" }] });
		expect(transport.close).toHaveBeenCalled();
		expect(logger.warn).toHaveBeenCalledWith(
			{ jobId: "run-test", error: "browser or model operation failed" },
			"failed to write result artifact",
		);
	});
	it("recovers from one action failure after a later snapshot and fails on step exhaustion", async () => {
		const transport = tabs();
		(transport.click as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
			new Error("stale ref"),
		);
		const recovered = await runAgent(
			job,
			{ systemPrompt: "s", processResult: () => [] },
			{
				model: {
					complete: vi
						.fn()
						.mockResolvedValueOnce({
							content: '{"action":"click","ref":"e1"}',
							usage: { prompt_tokens: 0, completion_tokens: 0 },
						})
						.mockResolvedValueOnce({
							content: '{"action":"done"}',
							usage: { prompt_tokens: 0, completion_tokens: 0 },
						}),
				},
				createTabs: () => transport,
				camofoxUrl: "http://c",
				maxSteps: 2,
				videoSecret: "s",
				wakeBrowser: vi.fn(),
			},
		);
		expect(recovered.ok).toBe(true);
		expect(transport.close).toHaveBeenCalledOnce();

		const exhausted = await runAgent(
			job,
			{ systemPrompt: "s", processResult: () => [] },
			{
				model: {
					complete: vi.fn().mockResolvedValue({
						content: '{"action":"scroll"}',
						usage: { prompt_tokens: 0, completion_tokens: 0 },
					}),
				},
				createTabs: tabs,
				camofoxUrl: "http://c",
				maxSteps: 1,
				videoSecret: "s",
				wakeBrowser: vi.fn(),
			},
		);
		expect(exhausted).toMatchObject({
			ok: false,
			error: "agent step limit exhausted",
		});
	});
});
