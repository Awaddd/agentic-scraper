import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./normalize-url.js";
import { buildJobsConfig } from "./task.js";

describe("jobs task", () => {
	it("projects listings and normalizes relative URLs", async () => {
		const config = buildJobsConfig(
			{
				jobId: "j",
				type: "jobs",
				url: "https://site.test/a",
				goal: "g",
				webhookUrl: "https://h.test",
			},
			{ lookup: async () => ["93.184.216.34"] },
		);
		expect(
			await config.processResult({
				listings: [{ title: "T", company: "C", url: "/job" }],
			}),
		).toEqual([{ title: "T", company: "C", url: "https://site.test/job" }]);
		expect(
			await normalizeUrl("https://other.test", "https://site.test", {
				lookup: async () => ["93.184.216.34"],
			}),
		).toBe("https://other.test/");
	});
});
