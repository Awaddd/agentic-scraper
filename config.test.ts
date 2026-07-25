import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("config", () => {
	it("validates required secret and defaults", () => {
		expect(() => loadConfig({})).toThrow();
		expect(loadConfig({ VIDEO_SECRET: "x" })).toMatchObject({
			PORT: 3000,
			MAX_STEPS: 12,
			CAMOFOX_URL: "http://camofox-browser:9377",
		});
	});
});
