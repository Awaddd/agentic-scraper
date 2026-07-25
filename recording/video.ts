import { execFile } from "node:child_process";
import { mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface VideoLogger {
	warn(bindings: object, message: string): void;
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
): Promise<void> {
	await mkdir(runDir, { recursive: true });
	const res = await fetcher(
		`${camofoxUrl}/tabs/${tabId}/screenshot?userId=${userId}`,
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
): Promise<boolean> {
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
			{ cwd: runDir },
		);
		const files = await readdir(runDir);
		await Promise.all(
			files
				.filter((f) => f.endsWith(".png"))
				.map((f) => unlink(join(runDir, f))),
		);
		return true;
	} catch (error) {
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
	}
}
