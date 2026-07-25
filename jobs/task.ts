import type { AgentJob, TaskConfig } from "./contracts.js";
import { normalizeUrl } from "./normalize-url.js";

const JOBS_SYSTEM = `You drive a browser via a REST API to find remote job listings.
You receive an accessibility snapshot of the current page. Elements are tagged with stable refs like [button e1], [link e2], [textbox e3].
Each turn, respond with ONLY one JSON object — no prose, no markdown fences:
{"thought":"<one line: what you see and why this action>","action":"click" | "type" | "scroll" | "navigate" | "done","ref":"e1","text":"...","pressEnter":false,"direction":"down","url":"https://...","listings":[{"title":"...","company":"...","url":"..."}]}
Rules: Pick refs ONLY from the snapshot. Never invent refs. Use "done" once you have the listings.`;

export function buildJobsConfig(job: AgentJob): TaskConfig {
  return { systemPrompt: JOBS_SYSTEM, processResult(act) {
    const origin = new URL(job.url).origin;
    const raw = Array.isArray(act.listings) ? act.listings : [];
    return (raw as Array<{ title?: string; company?: string; url?: string }>).map((l) => ({ title: l.title ?? "", company: l.company ?? "", url: normalizeUrl(l.url ?? "", origin) }));
  }};
}
