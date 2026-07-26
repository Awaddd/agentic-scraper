import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { AgentJob, AgentResult, TaskConfig } from "../jobs/contracts.js";
import { signVideoUrl } from "../recording/signed-url.js";
import {
	captureScreenshot,
	cleanupFrames,
	DEFAULT_FFMPEG_TIMEOUT_MS,
	stitchVideo,
	type VideoLogger,
} from "../recording/video.js";
import { createTabWithRetry, type Tabs } from "./camofox.js";
import type { DiagnosticLogger, Message, Model } from "./model.js";

const DEFAULT_MODEL = "glm-5.2";
const RECORDING_SETTLE_DELAY_MS = 1_500;
const ActionSchema = z
	.object({
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
	})
	.strict();

type Action = z.infer<typeof ActionSchema>;

export interface RunDependencies {
	model: Model;
	createTabs(userId: string): Tabs;
	camofoxUrl: string;
	maxSteps: number;
	videoSecret: string;
	wakeBrowser(timeoutMs?: number): Promise<void>;
	camofoxTimeoutMs?: number;
	recordingTimeoutMs?: number;
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
	if (fencedJson) json = fencedJson[1].trim();
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
	if (typeof tabId === "string" && tabId) return tabId;
	throw new Error("Camoufox did not return a tab identifier");
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

function recordingFor(job: AgentJob): RecordingContext | undefined {
	return job.record
		? { runDir: join("tmp", job.jobId), filename: `${job.jobId}.mp4` }
		: undefined;
}

function operationError(error: unknown): string {
	if (error instanceof SyntaxError) return "invalid agent action JSON";
	if (error instanceof Error && error.name === "TimeoutError")
		return "operation timed out";
	return "browser or model operation failed";
}

async function performAction(
	tabs: Tabs,
	tabId: string,
	action: Action,
): Promise<void> {
	switch (action.action) {
		case "click":
			return tabs.click(tabId, action.ref ?? "").then(() => undefined);
		case "type":
			return tabs
				.type(
					tabId,
					action.ref ?? "",
					action.text ?? "",
					action.pressEnter ?? false,
				)
				.then(() => undefined);
		case "scroll":
			return tabs
				.scroll(tabId, action.direction ?? "down")
				.then(() => undefined);
		case "navigate":
			return tabs.navigate(tabId, action.url ?? "").then(() => undefined);
		case "done":
			return;
	}
}

async function captureRecordingFrame(
	recording: RecordingContext | undefined,
	tabId: string,
	jobId: string,
	step: number,
	deps: RunDependencies,
): Promise<void> {
	if (!recording) return;
	try {
		await (deps.sleep ?? sleep)(RECORDING_SETTLE_DELAY_MS);
		await (deps.capture ?? captureScreenshot)(
			tabId,
			jobId,
			recording.runDir,
			step,
			deps.camofoxUrl,
			undefined,
			deps.camofoxTimeoutMs,
		);
	} catch (error) {
		deps.logger?.warn(
			{ jobId, error: operationError(error) },
			"recording frame failed",
		);
	}
}

async function finishRecording(
	recording: RecordingContext | undefined,
	jobId: string,
	deps: RunDependencies,
): Promise<string | undefined> {
	if (!recording) return undefined;
	const timeoutMs = deps.recordingTimeoutMs ?? DEFAULT_FFMPEG_TIMEOUT_MS;
	try {
		await mkdir("videos", { recursive: true });
		const outputPath = join("videos", recording.filename);
		const stitch = deps.stitch
			? deps.stitch(recording.runDir, outputPath)
			: stitchVideo(
					recording.runDir,
					outputPath,
					undefined,
					deps.logger,
					timeoutMs,
				);
		const stitched = await withRecordingTimeout(stitch, timeoutMs);
		if (!stitched) {
			deps.logger?.warn({ jobId }, "recording stitch did not produce video");
			return undefined;
		}
		return `/videos/${recording.filename}${signVideoUrl(recording.filename, deps.videoSecret)}`;
	} catch (error) {
		if (error instanceof RecordingTimeoutError) {
			deps.logger?.warn({ jobId }, "recording finalization timed out");
			return undefined;
		}
		deps.logger?.warn(
			{ jobId, error: operationError(error) },
			"recording finalization failed",
		);
		return undefined;
	} finally {
		await cleanupFrames(recording.runDir, deps.logger);
	}
}

class RecordingTimeoutError extends Error {
	constructor() {
		super("recording finalization timed out");
		this.name = "RecordingTimeoutError";
	}
}

function withRecordingTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new RecordingTimeoutError()),
			timeoutMs,
		);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error: unknown) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

async function writeResultArtifact(
	job: AgentJob,
	result: unknown,
	step: number,
	totals: TokenTotals,
	logger?: DiagnosticLogger,
): Promise<void> {
	try {
		await mkdir("results", { recursive: true });
		await writeFile(
			join("results", `${job.jobId}-${Date.now()}.md`),
			[
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
			].join("\n"),
		);
	} catch (error) {
		logger?.warn(
			{ jobId: job.jobId, error: operationError(error) },
			"failed to write result artifact",
		);
	}
}

function success(
	result: unknown,
	totals: TokenTotals,
	steps: number,
	startedAt: number,
	videoUrl?: string,
): AgentResult {
	return {
		ok: true,
		result,
		tokens: resultTokens(totals),
		steps,
		durationMs: Date.now() - startedAt,
		...(videoUrl ? { videoUrl } : {}),
	};
}

function failure(
	error: string,
	totals: TokenTotals,
	steps: number,
	startedAt: number,
): AgentResult {
	return {
		ok: false,
		result: null,
		error,
		tokens: resultTokens(totals),
		steps,
		durationMs: Date.now() - startedAt,
	};
}

export async function runAgent(
	job: AgentJob,
	taskConfig: TaskConfig,
	deps: RunDependencies,
): Promise<AgentResult> {
	const startedAt = Date.now();
	const totals: TokenTotals = { prompt: 0, completion: 0 };
	const tabs = deps.createTabs(job.jobId);
	const recording = recordingFor(job);
	let tabId: string | undefined;
	let steps = 0;
	try {
		const tab = await createTabWithRetry(
			(url, sessionKey, timeoutMs) => tabs.create(url, sessionKey, timeoutMs),
			job.url,
			`scrape-${job.jobId}`,
			deps.wakeBrowser,
			{ timeoutMs: deps.camofoxTimeoutMs, sleep: deps.sleep },
		);
		tabId = tabIdFrom(tab);
		if (recording) {
			try {
				await mkdir(recording.runDir, { recursive: true });
			} catch (error) {
				deps.logger?.warn(
					{ jobId: job.jobId, error: operationError(error) },
					"recording setup failed",
				);
			}
		}

		const messages: Message[] = [
			{ role: "system", content: taskConfig.systemPrompt },
		];
		for (let step = 1; step <= deps.maxSteps; step++) {
			steps = step;
			let snapshot: string;
			try {
				snapshot = ((await tabs.snapshot(tabId)).snapshot as string) ?? "";
			} catch (error) {
				return failure(operationError(error), totals, steps, startedAt);
			}
			compressPreviousSnapshot(messages, step);
			messages.push({
				role: "user",
				content: buildStepUserMessage({
					goal: job.goal,
					snapshot,
					context: job.context,
				}),
			});
			let response: Awaited<ReturnType<Model["complete"]>>;
			try {
				response = await deps.model.complete(
					messages,
					job.model ?? DEFAULT_MODEL,
				);
				addUsage(totals, response.usage);
			} catch (error) {
				return failure(operationError(error), totals, steps, startedAt);
			}
			let action: Action;
			try {
				const parsed = ActionSchema.safeParse(parseAction(response.content));
				if (!parsed.success) {
					deps.logger?.warn(
						{ jobId: job.jobId, issueCount: parsed.error.issues.length },
						"action failed schema validation",
					);
					return failure(
						"invalid agent action schema",
						totals,
						steps,
						startedAt,
					);
				}
				action = parsed.data;
			} catch (error) {
				deps.logger?.warn(
					{ jobId: job.jobId, error: operationError(error) },
					"action JSON parsing failed",
				);
				return failure("invalid agent action JSON", totals, steps, startedAt);
			}
			if (action.action === "done") {
				try {
					const result = await taskConfig.processResult(action);
					const videoUrl = await finishRecording(recording, job.jobId, deps);
					await writeResultArtifact(job, result, steps, totals, deps.logger);
					return success(result, totals, steps, startedAt, videoUrl);
				} catch (error) {
					return failure(operationError(error), totals, steps, startedAt);
				}
			}
			try {
				await performAction(tabs, tabId, action);
			} catch (error) {
				deps.logger?.warn(
					{
						jobId: job.jobId,
						action: action.action,
						error: operationError(error),
					},
					"recoverable browser action failed",
				);
			}
			await captureRecordingFrame(recording, tabId, job.jobId, step, deps);
			messages.push({ role: "assistant", content: response.content });
		}
		return failure("agent step limit exhausted", totals, steps, startedAt);
	} catch (error) {
		return failure(operationError(error), totals, steps, startedAt);
	} finally {
		if (tabId) await tabs.close(tabId).catch(() => {});
	}
}
