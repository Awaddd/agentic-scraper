import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stitchVideo } from "./video.js";

describe("recording", () => {
	it("invokes ffmpeg with argument-based options and removes frames only after success", async () => {
		const directory = await mkdtemp(join(tmpdir(), "scraper-video-"));
		await writeFile(join(directory, "step-0001.png"), "frame");
		const execute = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
		await expect(
			stitchVideo(directory, "videos/out.mp4", execute as never),
		).resolves.toBe(true);
		expect(execute).toHaveBeenCalledWith(
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
				expect.stringMatching(/videos\/out\.mp4$/),
			],
			{ cwd: directory },
		);
		expect(await readdir(directory)).toEqual([]);
	});

	it("warns when ffmpeg is unavailable and retains frames", async () => {
		const directory = await mkdtemp(join(tmpdir(), "scraper-video-"));
		await writeFile(join(directory, "step-0001.png"), "frame");
		const logger = { warn: vi.fn() };
		await expect(
			stitchVideo(
				directory,
				"videos/out.mp4",
				vi.fn().mockRejectedValue(new Error("spawn ffmpeg ENOENT")) as never,
				logger,
			),
		).resolves.toBe(false);
		expect(await readdir(directory)).toContain("step-0001.png");
		expect(logger.warn).toHaveBeenCalledWith(
			{ error: "spawn ffmpeg ENOENT" },
			"ffmpeg unavailable — skipping video production",
		);
	});

	it("warns when ffmpeg stitching fails", async () => {
		const directory = await mkdtemp(join(tmpdir(), "scraper-video-"));
		const logger = { warn: vi.fn() };
		await expect(
			stitchVideo(
				directory,
				"videos/out.mp4",
				vi.fn().mockRejectedValue(new Error("encoding failed")) as never,
				logger,
			),
		).resolves.toBe(false);
		expect(logger.warn).toHaveBeenCalledWith(
			{ error: "encoding failed" },
			"ffmpeg stitch failed",
		);
	});
});
