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
const tasks = { jobs: buildJobsConfig };
const app = createApp({
	camofoxUrl: config.CAMOFOX_URL,
	videoSecret: config.VIDEO_SECRET,
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
					),
					createTabs: (userId) => createCamofox(config.CAMOFOX_URL, userId),
					camofoxUrl: config.CAMOFOX_URL,
					maxSteps: config.MAX_STEPS,
					videoSecret: config.VIDEO_SECRET,
					wakeBrowser: () => wakeBrowser(config.CAMOFOX_URL),
					logger,
				}),
			deliver: (url, payload) =>
				deliverWebhook(url, payload, config.SCRAPER_WEBHOOK_SECRET),
		}),
	verifyVideo: (filename, token, expiry) =>
		verifySignedUrl(filename, token, expiry, config.VIDEO_SECRET),
	fileExists: access,
	openVideo: createReadStream,
});
serve({ fetch: app.fetch, port: config.PORT }, () =>
	logger.info({ port: config.PORT }, "agentic scraper started"),
);
