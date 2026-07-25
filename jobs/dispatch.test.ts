import { describe, expect, it, vi } from "vitest";
import { dispatchJob } from "./dispatch.js";
import { buildJobsConfig } from "./task.js";

const job = {
	jobId: "j",
	type: "jobs",
	url: "https://x.test",
	goal: "x",
	webhookUrl: "https://hook.test",
};
describe("dispatch", () => {
	it("does not turn a successful scrape into a failure callback when delivery fails", async () => {
		const deliver = vi.fn().mockRejectedValue(new Error("network"));
		const logger = { error: vi.fn() };
		await dispatchJob(job, {
			tasks: { jobs: buildJobsConfig },
			runAgent: vi.fn().mockResolvedValue({
				result: [],
				tokens: { prompt: 0, completion: 0, total: 0 },
				steps: 1,
				durationMs: 1,
			}),
			deliver,
			logger,
		});
		expect(deliver).toHaveBeenCalledTimes(1);
		expect(deliver.mock.calls[0]?.[1]).toMatchObject({ ok: true });
		expect(logger.error).toHaveBeenCalledWith(
			expect.anything(),
			"callback delivery failed",
		);
	});
});
