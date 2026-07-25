import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stitchVideo } from "./video.js";

describe("recording", () => {
  it("invokes ffmpeg with argument-based options and removes frames only after success", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scraper-video-"));
    await writeFile(join(directory, "step-0001.png"), "frame");
    const execute = vi.fn().mockResolvedValue({ stdout: "", stderr: "" });
    await expect(stitchVideo(directory, "videos/out.mp4", execute as never)).resolves.toBe(true);
    expect(execute).toHaveBeenCalledWith("ffmpeg", ["-y", "-framerate", "1", "-pattern_type", "glob", "-i", "*.png", "-c:v", "libx264", "-pix_fmt", "yuv420p", expect.stringMatching(/videos\/out\.mp4$/)], { cwd: directory });
    expect(await readdir(directory)).toEqual([]);
  });

  it("retains frames when ffmpeg fails", async () => {
    const directory = await mkdtemp(join(tmpdir(), "scraper-video-"));
    await writeFile(join(directory, "step-0001.png"), "frame");
    await expect(stitchVideo(directory, "videos/out.mp4", vi.fn().mockRejectedValue(new Error("ffmpeg unavailable")) as never)).resolves.toBe(false);
    expect(await readdir(directory)).toContain("step-0001.png");
  });
});
