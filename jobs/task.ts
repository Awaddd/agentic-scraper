import type { AgentJob, TaskConfig } from "./contracts.js";
import { normalizeUrl } from "./normalize-url.js";

const JOBS_SYSTEM = `You drive a browser via a REST API to find remote job listings.
You receive an accessibility snapshot of the current page. Elements are tagged with stable refs like [button e1], [link e2], [textbox e3].
Each turn, respond with ONLY one JSON object — no prose, no markdown fences:
{
  "thought": "<one line: what you see and why this action>",
  "action": "click" | "type" | "scroll" | "navigate" | "done",
  "ref": "e1",
  "text": "...",
  "pressEnter": false,
  "direction": "down",
  "url": "https://...",
  "listings": [
    {"title":"...","company":"...","url":"..."}
  ]
}
Rules:
- To narrow results, use the search box if one is available. If there is no search box, use ONE filter category and do not change it. Do not combine search and tag filters. Apply filtering once and move on.
- Pick refs ONLY from the snapshot. Never invent refs.
- Use "done" once you have the listings (or are confident the page has no more to load).
- Output exactly one JSON object and nothing else.
- When extracting listings, only include real job postings. Skip anything that is an ad, sponsored placement, or has a URL containing "/listing_ads/", tracking tokens, or redirect parameters. A real listing has a specific job title, a real company name, and a direct URL to the job post.`;

export function buildJobsConfig(job: AgentJob): TaskConfig {
	return {
		systemPrompt: JOBS_SYSTEM,
		processResult(act) {
			const origin = new URL(job.url).origin;
			const raw = Array.isArray(act.listings) ? act.listings : [];
			return (
				raw as Array<{ title?: string; company?: string; url?: string }>
			).map((l) => ({
				title: l.title ?? "",
				company: l.company ?? "",
				url: normalizeUrl(l.url ?? "", origin),
			}));
		},
	};
}
