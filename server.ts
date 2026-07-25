import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { serve } from "@hono/node-server";
import pino from "pino";
import { createCamofox, wakeBrowser } from "./agent/camofox.js";
import { createModel } from "./agent/model.js";
import { runAgent } from "./agent/run.js";
import { createApp } from "./app.js";
import { deliverWebhook } from "./callbacks/webhook.js";
import { loadConfig } from "./config.js";
import { dispatchJob } from "./jobs/dispatch.js";
import { buildJobsConfig } from "./jobs/task.js";
import { verifySignedUrl } from "./recording/signed-url.js";

const config = loadConfig();
const logger = pino({ level: "info" });
const outboundPolicy = {
	mode: config.SCRAPER_ALLOW_INSECURE_LOCAL
		? ("loopback" as const)
		: ("public" as const),
};
const tasks = {
	jobs: (job: Parameters<typeof buildJobsConfig>[0]) =>
		buildJobsConfig(job, outboundPolicy),
};
const app = createApp({
	camofoxUrl: config.CAMOFOX_URL,
	videoSecret: config.VIDEO_SECRET,
	apiKey: config.SCRAPER_API_KEY,
	allowInsecureLocal: config.SCRAPER_ALLOW_INSECURE_LOCAL,
	camofoxTimeoutMs: config.CAMOFOX_TIMEOUT_MS,
	outboundPolicy,
	tasks,
	dispatch: (job) =>
		dispatchJob(job, {
			tasks,
			logger,
			runAgent: (candidate, task) =>
				runAgent(candidate, task, {
					model: createModel(
						config.OLLAMA_BASE_URL,
						config.OLLAMA_API_KEY,
						fetch,
						logger,
						config.MODEL_TIMEOUT_MS,
					),
					createTabs: (userId) =>
						createCamofox(config.CAMOFOX_URL, userId, fetch, {
							timeoutMs: config.CAMOFOX_TIMEOUT_MS,
							outboundPolicy,
						}),
					camofoxUrl: config.CAMOFOX_URL,
					maxSteps: config.MAX_STEPS,
					videoSecret: config.VIDEO_SECRET,
					camofoxTimeoutMs: config.CAMOFOX_TIMEOUT_MS,
					wakeBrowser: (timeoutMs) =>
						wakeBrowser(config.CAMOFOX_URL, fetch, timeoutMs),
					logger,
				}),
			deliver: (url, payload) =>
				deliverWebhook(
					url,
					payload,
					config.SCRAPER_WEBHOOK_SECRET,
					fetch,
					config.WEBHOOK_TIMEOUT_MS,
					outboundPolicy,
				),
		}),
	verifyVideo: (filename, token, expiry) =>
		verifySignedUrl(filename, token, expiry, config.VIDEO_SECRET),
	fileExists: access,
	openVideo: createReadStream,
});
serve(
	{ fetch: app.fetch, port: config.PORT, hostname: config.SCRAPER_HOST },
	() =>
		logger.info(
			{ host: config.SCRAPER_HOST, port: config.PORT },
			"agentic scraper started",
		),
);
