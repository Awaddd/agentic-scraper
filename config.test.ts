import { describe, expect, it } from "vitest";
import { loadConfig } from "./config.js";

describe("config", () => {
	it("validates required secret and defaults", () => {
		expect(() => loadConfig({})).toThrow();
		expect(
			loadConfig({ VIDEO_SECRET: "x", SCRAPER_API_KEY: "key" }),
		).toMatchObject({
			PORT: 3000,
			MAX_STEPS: 12,
			CAMOFOX_URL: "http://camofox-browser:9377",
		});
	});
	it("permits an explicit loopback-only local bypass", () => {
		expect(
			loadConfig({
				VIDEO_SECRET: "x",
				SCRAPER_ALLOW_INSECURE_LOCAL: "true",
				SCRAPER_HOST: "127.0.0.1",
			}).SCRAPER_ALLOW_INSECURE_LOCAL,
		).toBe(true);
		expect(() =>
			loadConfig({
				VIDEO_SECRET: "x",
				SCRAPER_ALLOW_INSECURE_LOCAL: "true",
				SCRAPER_HOST: "0.0.0.0",
			}),
		).toThrow("SCRAPER_HOST");
	});
});
