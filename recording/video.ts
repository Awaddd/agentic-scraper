import { execFile } from "node:child_process";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fetchWithTimeout } from "../lib/abortable-fetch.js";

const execFileAsync = promisify(execFile);
export const DEFAULT_FFMPEG_TIMEOUT_MS = 30_000;

export interface VideoLogger {
	warn(bindings: object, message: string): void;
}

export async function cleanupFrames(
	runDir: string,
	logger?: VideoLogger,
): Promise<void> {
	try {
		const files = await readdir(runDir);
		await Promise.all(
			files
				.filter((file) => file.endsWith(".png"))
				.map((file) => unlink(join(runDir, file))),
		);
	} catch {
		logger?.warn({}, "recording frame cleanup failed");
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isFfmpegUnavailable(message: string): boolean {
	return (
		message.includes("ENOENT") ||
		message.includes("not found") ||
		message.includes("No such file") ||
		message.includes("command not found")
	);
}

export async function captureScreenshot(
	tabId: string,
	userId: string,
	runDir: string,
	step: number,
	camofoxUrl: string,
	fetcher: typeof fetch = fetch,
	timeoutMs = 20_000,
): Promise<void> {
	await mkdir(runDir, { recursive: true });
	const res = await fetchWithTimeout(
		fetcher,
		`${camofoxUrl}/tabs/${tabId}/screenshot?userId=${userId}`,
		{},
		timeoutMs,
		"recording screenshot",
	);
	if (!res.ok) throw new Error(`screenshot failed: ${res.status}`);
	await writeFile(
		join(runDir, `step-${String(step).padStart(4, "0")}.png`),
		Buffer.from(await res.arrayBuffer()),
	);
}
export async function stitchVideo(
	runDir: string,
	outPath: string,
	execute: typeof execFileAsync = execFileAsync,
	logger?: VideoLogger,
	timeoutMs = DEFAULT_FFMPEG_TIMEOUT_MS,
): Promise<boolean> {
	const controller = new AbortController();
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);
	try {
		await execute(
			"ffmpeg",
			[
				"-y",
				"-framerate",
				"1",
				"-pattern_type",
				"glob",
				"-i",
				"*.png",
				"-c:v",
				"libx264",
				"-pix_fmt",
				"yuv420p",
				resolve(outPath),
			],
			{ cwd: runDir, signal: controller.signal },
		);
		return true;
	} catch (error) {
		if (timedOut) {
			logger?.warn({}, "ffmpeg stitch timed out");
			return false;
		}
		const message = errorMessage(error);
		if (isFfmpegUnavailable(message)) {
			logger?.warn(
				{ error: message },
				"ffmpeg unavailable — skipping video production",
			);
		} else {
			logger?.warn({ error: message }, "ffmpeg stitch failed");
		}
		return false;
	} finally {
		clearTimeout(timer);
		await cleanupFrames(runDir, logger);
	}
}
