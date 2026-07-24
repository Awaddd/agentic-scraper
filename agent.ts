import { mkdir, writeFile } from "fs/promises";
import { join } from "path";
import pino from "pino";
import { z } from "zod";
import type { AgentJob } from "./server.js";
import { captureScreenshot, stitchVideo } from "./video.js";
import { signVideoUrl } from "./lib/signedUrl.js";

const ActionSchema = z.object({
  thought: z.string().optional(),
  action: z.enum(["click", "type", "scroll", "navigate", "done"]),
  ref: z.string().optional(),
  text: z.string().optional(),
  pressEnter: z.boolean().optional(),
  direction: z.string().optional(),
  url: z.string().optional(),
  listings: z.array(z.object({
    title: z.string(),
    company: z.string(),
    url: z.string(),
  })).optional(),
});

const logger = pino({ level: "info" });

export interface TaskConfig {
  systemPrompt: string;
  processResult: (act: Record<string, unknown>) => unknown;
}

export interface AgentResult {
  ok: boolean;
  result: unknown;
  tokens: { prompt: number; completion: number; total: number };
  steps: number;
  durationMs: number;
  videoUrl?: string;
}

const CAMOFOX_URL = process.env.CAMOFOX_URL ?? "http://camofox-browser:9377";
const OLLAMA_BASE = process.env.OLLAMA_BASE_URL ?? "https://ollama.com/v1";
const DEFAULT_MODEL = "glm-5.2";
const MAX_STEPS = Number(process.env.MAX_STEPS ?? 12);

// --- camofox-browser REST helpers -------------------------------------------

async function camo(method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(CAMOFOX_URL + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`camo ${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function makeTabs(userId: string) {
  return {
    create: (url: string, sessionKey: string) =>
      camo("POST", "/tabs", { userId, sessionKey, url }),
    snapshot: (id: string) =>
      camo("GET", `/tabs/${id}/snapshot?userId=${userId}`),
    click: (id: string, ref: string) =>
      camo("POST", `/tabs/${id}/click`, { userId, ref }),
    type: (id: string, ref: string, text: string, pressEnter = false) =>
      camo("POST", `/tabs/${id}/type`, { userId, ref, text, pressEnter }),
    scroll: (id: string, direction: string) =>
      camo("POST", `/tabs/${id}/scroll`, { userId, direction }),
    navigate: (id: string, url: string) =>
      camo("POST", `/tabs/${id}/navigate`, { userId, url }),
    screenshot: (id: string) =>
      fetch(`${CAMOFOX_URL}/tabs/${id}/screenshot?userId=${userId}`),
    close: (id: string) =>
      camo("DELETE", `/tabs/${id}?userId=${userId}`),
  };
}

// --- LLM via Ollama Cloud (OpenAI-compatible) --------------------------------

interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

async function llmOnce(
  messages: Message[],
  model: string,
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  const apiKey = process.env.OLLAMA_API_KEY;
  const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      // Force a fresh connection per call — a pooled keep-alive socket reused across
      // calls has been observed to occasionally return two concatenated response
      // bodies (JSON.parse fails with "Unexpected non-whitespace character after
      // JSON"), consistent with stale bytes left over from a prior response on reuse.
      Connection: "close",
    },
    body: JSON.stringify({ model, messages, temperature: 0, stream: false, response_format: { type: "json_object" } }),
  });
  if (!res.ok) throw new Error(`llm -> ${res.status}: ${(await res.text()).slice(0, 400)}`);
  const rawText = await res.text();
  const data = JSON.parse(rawText) as {
    choices?: Array<{ message: { content: string } }>;
    usage?: { prompt_tokens: number; completion_tokens: number };
  };
  return {
    content: data.choices?.[0]?.message?.content ?? "",
    usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
  };
}

async function llm(
  messages: Message[],
  model: string,
): Promise<{ content: string; usage: { prompt_tokens: number; completion_tokens: number } }> {
  try {
    return await llmOnce(messages, model);
  } catch (err) {
    if (!(err instanceof SyntaxError)) throw err;
    // Malformed-JSON response — retry once on a fresh request/connection before giving up.
    logger.warn({ err: err.message }, "llm response failed to parse, retrying once");
    return await llmOnce(messages, model);
  }
}

// --- Robust JSON extraction (glm-5.2 may wrap in ```json fences) ------------

function parseAction(text: string): Record<string, unknown> {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) s = s.slice(start, end + 1);
  return JSON.parse(s) as Record<string, unknown>;
}

// --- Main agent loop --------------------------------------------------------

export function buildStepUserMessage(args: {
  goal: string;
  snapshot: string;
  context?: Record<string, unknown>;
}): string {
  let content = `GOAL: ${args.goal}\n\nCURRENT SNAPSHOT:\n${args.snapshot}`;
  if (args.context) {
    content += `\n\nCONTEXT:\n${JSON.stringify(args.context)}`;
  }
  return content;
}

export async function wakeBrowser(): Promise<void> {
  try {
    await globalThis.fetch(`${CAMOFOX_URL}/health`);
  } catch {
    // best-effort — swallow errors so a failed wake doesn't throw out of the retry loop
  }
}

export async function createTabWithRetry<T>(
  createTab: (url: string, sessionKey: string) => Promise<T>,
  url: string,
  sessionKey: string,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      return await createTab(url, sessionKey);
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes("503") && !msg.includes("session_expired")) {
        throw err;
      }
      if (attempt < 3) {
        await wakeBrowser();
      }
    }
  }
  throw lastError;
}

export async function runAgent(job: AgentJob, taskConfig: TaskConfig): Promise<AgentResult> {
  const startedAt = Date.now();
  const model = job.model ?? DEFAULT_MODEL;
  const sessionKey = job.sessionKey ?? `scrape-${job.jobId}`;
  const userId = job.jobId;
  const tabs = makeTabs(userId);

  const tab = await createTabWithRetry((u, s) => tabs.create(u, s), job.url, sessionKey);
  const tabId = (tab.id ?? tab.tabId ?? (tab.tab as Record<string, unknown>)?.id) as string;
  if (!tabId) throw new Error(`Could not find tab id in POST /tabs response: ${JSON.stringify(tab).slice(0, 500)}`);

  const messages: Message[] = [{ role: "system", content: taskConfig.systemPrompt }];
  let totalPrompt = 0;
  let totalCompletion = 0;
  let lastResult: unknown = null;

  const runDir = job.record ? join("tmp", job.jobId) : null;
  if (runDir) await mkdir(runDir, { recursive: true });

  const finalize = async (): Promise<string | undefined> => {
    if (!runDir) return undefined;
    const filename = `${job.jobId}.mp4`;
    const outPath = join("videos", filename);
    await mkdir("videos", { recursive: true });
    const stitched = await stitchVideo(runDir, outPath);
    if (!stitched) return undefined;
    return `/videos/${filename}${signVideoUrl(filename)}`;
  };

  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      const snap = await tabs.snapshot(tabId);
      const page = (snap.snapshot as string) ?? "";

      // Snapshot compression: replace step N-1 user message with a one-liner
      if (messages.length >= 2) {
        const prev = messages[messages.length - 2];
        if (prev?.role === "user" && prev.content.startsWith("GOAL:")) {
          prev.content = `[step ${step - 1} snapshot — compressed]`;
        }
      }

      const userContent = buildStepUserMessage({ goal: job.goal, snapshot: page, context: job.context });
      messages.push({ role: "user", content: userContent });

      const { content, usage } = await llm(messages, model);
      totalPrompt += usage.prompt_tokens ?? 0;
      totalCompletion += usage.completion_tokens ?? 0;

      const parsed = ActionSchema.safeParse(parseAction(content));
      if (!parsed.success) {
        logger.warn({ jobId: job.jobId, issues: parsed.error.issues }, "action failed schema validation");
        break;
      }
      const act = parsed.data;

      if (act.action === "done") {
        lastResult = taskConfig.processResult(act);
        await tabs.close(tabId);
        const videoUrl = await finalize();

        const ts = new Date().toISOString();
        const mdContent = [
          `# ${job.type} — ${ts}`,
          ``,
          `**URL:** ${job.url}`,
          `**Steps:** ${step}`,
          `**Tokens:** ${totalPrompt + totalCompletion} (prompt ${totalPrompt} / completion ${totalCompletion})`,
          ``,
          "```json",
          JSON.stringify(lastResult, null, 2),
          "```",
          "",
        ].join("\n");
        try {
          await mkdir("results", { recursive: true });
          await writeFile(join("results", `${job.jobId}-${Date.now()}.md`), mdContent);
        } catch (err) {
          logger.warn({ jobId: job.jobId, err }, "failed to write result file");
        }

        return {
          ok: true,
          result: lastResult,
          tokens: { prompt: totalPrompt, completion: totalCompletion, total: totalPrompt + totalCompletion },
          steps: step,
          durationMs: Date.now() - startedAt,
          videoUrl,
        };
      }

      // Execute action
      try {
        if (act.action === "click") await tabs.click(tabId, act.ref ?? "");
        else if (act.action === "type")
          await tabs.type(tabId, act.ref ?? "", act.text ?? "", act.pressEnter ?? false);
        else if (act.action === "scroll") await tabs.scroll(tabId, act.direction ?? "down");
        else if (act.action === "navigate") await tabs.navigate(tabId, act.url ?? "");
      } catch {
        // action failed — continue loop
      }

      // Capture screenshot after each action when record:true
      if (runDir) {
        await new Promise(r => setTimeout(r, 1500));
        await captureScreenshot(tabId, userId, runDir, step).catch(() => {});
      }

      messages.push({ role: "assistant", content });
    }

    // MAX_STEPS reached
    await tabs.close(tabId);
    const videoUrl = await finalize();
    return {
      ok: true,
      result: lastResult,
      tokens: { prompt: totalPrompt, completion: totalCompletion, total: totalPrompt + totalCompletion },
      steps: MAX_STEPS,
      durationMs: Date.now() - startedAt,
      videoUrl,
    };
  } catch (err) {
    // Best-effort close
    await tabs.close(tabId).catch(() => {});
    throw err;
  }
}
