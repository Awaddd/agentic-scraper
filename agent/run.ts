import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentJob, AgentResult, TaskConfig } from "../jobs/contracts.js";
import { signVideoUrl } from "../recording/signed-url.js";
import {
	captureScreenshot,
	stitchVideo,
	type VideoLogger,
} from "../recording/video.js";
import { createTabWithRetry, type Tabs } from "./camofox.js";
import type { DiagnosticLogger, Message, Model } from "./model.js";

const DEFAULT_MODEL = "glm-5.2";
const RECORDING_SETTLE_DELAY_MS = 1_500;
const ActionSchema = z.object({
	thought: z.string().optional(),
	action: z.enum(["click", "type", "scroll", "navigate", "done"]),
	ref: z.string().optional(),
	text: z.string().optional(),
	pressEnter: z.boolean().optional(),
	direction: z.string().optional(),
	url: z.string().optional(),
	listings: z
		.array(
			z.object({
				title: z.string(),
				company: z.string(),
				url: z.string(),
			}),
		)
		.optional(),
});

type Action = z.infer<typeof ActionSchema>;

export interface RunDependencies {
	model: Model;
	createTabs(userId: string): Tabs;
	camofoxUrl: string;
	maxSteps: number;
	videoSecret: string;
	wakeBrowser(): Promise<void>;
	logger?: DiagnosticLogger & VideoLogger;
	sleep?: (milliseconds: number) => Promise<void>;
	capture?: typeof captureScreenshot;
	stitch?: (runDir: string, outputPath: string) => Promise<boolean>;
}

interface RecordingContext {
	runDir: string;
	filename: string;
}

interface TokenTotals {
	prompt: number;
	completion: number;
}

export const sleep = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function buildStepUserMessage(args: {
	goal: string;
	snapshot: string;
	context?: Record<string, unknown>;
}): string {
	const context = args.context
		? `\n\nCONTEXT:\n${JSON.stringify(args.context)}`
		: "";
	return `GOAL: ${args.goal}\n\nCURRENT SNAPSHOT:\n${args.snapshot}${context}`;
}

function parseAction(content: string): Record<string, unknown> {
	let json = content.trim();
	const fencedJson = json.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fencedJson) {
		json = fencedJson[1].trim();
	}

	const firstBrace = json.indexOf("{");
	const lastBrace = json.lastIndexOf("}");
	if (firstBrace >= 0 && lastBrace > firstBrace) {
		json = json.slice(firstBrace, lastBrace + 1);
	}

	return JSON.parse(json) as Record<string, unknown>;
}

function tabIdFrom(response: Record<string, unknown>): string {
	const nestedTab = response.tab as Record<string, unknown> | undefined;
	const tabId = response.id ?? response.tabId ?? nestedTab?.id;
	if (typeof tabId === "string" && tabId) {
		return tabId;
	}

	throw new Error(
		`Could not find tab id in POST /tabs response: ${JSON.stringify(response).slice(0, 500)}`,
	);
}

function compressPreviousSnapshot(messages: Message[], step: number): void {
	const previous = messages.at(-2);
	if (previous?.role === "user" && previous.content.startsWith("GOAL:")) {
		previous.content = `[step ${step - 1} snapshot — compressed]`;
	}
}

function addUsage(
	totals: TokenTotals,
	usage: { prompt_tokens: number; completion_tokens: number },
): void {
	totals.prompt += usage.prompt_tokens ?? 0;
	totals.completion += usage.completion_tokens ?? 0;
}

function resultTokens(totals: TokenTotals): AgentResult["tokens"] {
	return {
		prompt: totals.prompt,
		completion: totals.completion,
		total: totals.prompt + totals.completion,
	};
}

async function performAction(
	tabs: Tabs,
	tabId: string,
	action: Action,
): Promise<void> {
	try {
		switch (action.action) {
			case "click":
				await tabs.click(tabId, action.ref ?? "");
				break;
			case "type":
				await tabs.type(
					tabId,
					action.ref ?? "",
					action.text ?? "",
					action.pressEnter ?? false,
				);
				break;
			case "scroll":
				await tabs.scroll(tabId, action.direction ?? "down");
				break;
			case "navigate":
				await tabs.navigate(tabId, action.url ?? "");
				break;
			case "done":
				break;
		}
	} catch {
		// An action failure is non-fatal; the next snapshot lets the model recover.
	}
}

function recordingFor(job: AgentJob): RecordingContext | undefined {
	if (!job.record) {
		return undefined;
	}

	return {
		runDir: join("tmp", job.jobId),
		filename: `${job.jobId}.mp4`,
	};
}

async function captureRecordingFrame(
	recording: RecordingContext | undefined,
	tabId: string,
	jobId: string,
	step: number,
	deps: RunDependencies,
): Promise<void> {
	if (!recording) {
		return;
	}

	await (deps.sleep ?? sleep)(RECORDING_SETTLE_DELAY_MS);
	await (deps.capture ?? captureScreenshot)(
		tabId,
		jobId,
		recording.runDir,
		step,
		deps.camofoxUrl,
	).catch(() => {});
}

async function finishRecording(
	recording: RecordingContext | undefined,
	deps: RunDependencies,
): Promise<string | undefined> {
	if (!recording) {
		return undefined;
	}

	await mkdir("videos", { recursive: true });
	const outputPath = join("videos", recording.filename);
	const stitched = deps.stitch
		? await deps.stitch(recording.runDir, outputPath)
		: await stitchVideo(recording.runDir, outputPath, undefined, deps.logger);
	return stitched
		? `/videos/${recording.filename}${signVideoUrl(recording.filename, deps.videoSecret)}`
		: undefined;
}

async function writeResultArtifact(
	job: AgentJob,
	result: unknown,
	step: number,
	totals: TokenTotals,
	logger?: DiagnosticLogger,
): Promise<void> {
	const artifact = [
		`# ${job.type} — ${new Date().toISOString()}`,
		"",
		`**URL:** ${job.url}`,
		`**Steps:** ${step}`,
		`**Tokens:** ${totals.prompt + totals.completion} (prompt ${totals.prompt} / completion ${totals.completion})`,
		"",
		"```json",
		JSON.stringify(result, null, 2),
		"```",
		"",
	].join("\n");

	try {
		await mkdir("results", { recursive: true });
		await writeFile(join("results", `${job.jobId}-${Date.now()}.md`), artifact);
	} catch (error) {
		// Result artifacts are useful for review but must not fail a completed scrape.
		const message = error instanceof Error ? error.message : String(error);
		logger?.warn(
			{ jobId: job.jobId, error: message },
			"failed to write result artifact",
		);
	}
}

function completedResult(
	result: unknown,
	totals: TokenTotals,
	step: number,
	startedAt: number,
	videoUrl?: string,
): AgentResult {
	return {
		ok: true,
		result,
		tokens: resultTokens(totals),
		steps: step,
		durationMs: Date.now() - startedAt,
		videoUrl,
	};
}

export async function runAgent(
	job: AgentJob,
	taskConfig: TaskConfig,
	deps: RunDependencies,
): Promise<AgentResult> {
	const startedAt = Date.now();
	const tabs = deps.createTabs(job.jobId);
	const sessionKey = job.sessionKey ?? `scrape-${job.jobId}`;
	const tab = await createTabWithRetry(
		(url, key) => tabs.create(url, key),
		job.url,
		sessionKey,
		deps.wakeBrowser,
	);
	const tabId = tabIdFrom(tab);
	const messages: Message[] = [
		{ role: "system", content: taskConfig.systemPrompt },
	];
	const totals: TokenTotals = { prompt: 0, completion: 0 };
	const recording = recordingFor(job);
	let lastResult: unknown = null;

	if (recording) {
		await mkdir(recording.runDir, { recursive: true });
	}

	try {
		for (let step = 1; step <= deps.maxSteps; step++) {
			const snapshot = ((await tabs.snapshot(tabId)).snapshot as string) ?? "";
			compressPreviousSnapshot(messages, step);
			messages.push({
				role: "user",
				content: buildStepUserMessage({
					goal: job.goal,
					snapshot,
					context: job.context,
				}),
			});

			const response = await deps.model.complete(
				messages,
				job.model ?? DEFAULT_MODEL,
			);
			addUsage(totals, response.usage);
			const parsedAction = ActionSchema.safeParse(
				parseAction(response.content),
			);
			if (!parsedAction.success) {
				deps.logger?.warn(
					{ jobId: job.jobId, issues: parsedAction.error.issues },
					"action failed schema validation",
				);
				break;
			}

			const action = parsedAction.data;
			if (action.action === "done") {
				lastResult = taskConfig.processResult(action);
				await tabs.close(tabId);
				const videoUrl = await finishRecording(recording, deps);
				await writeResultArtifact(job, lastResult, step, totals, deps.logger);
				return completedResult(lastResult, totals, step, startedAt, videoUrl);
			}

			await performAction(tabs, tabId, action);
			await captureRecordingFrame(recording, tabId, job.jobId, step, deps);
			messages.push({ role: "assistant", content: response.content });
		}

		await tabs.close(tabId);
		const videoUrl = await finishRecording(recording, deps);
		return completedResult(
			lastResult,
			totals,
			deps.maxSteps,
			startedAt,
			videoUrl,
		);
	} catch (error) {
		await tabs.close(tabId).catch(() => {});
		throw error;
	}
}
