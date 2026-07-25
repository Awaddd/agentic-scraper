import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AgentJob, TaskBuilder } from "./jobs/contracts.js";

const RequestSchema = z
	.object({
		url: z.string().min(1, "url must be a non-empty string"),
		goal: z.string().min(1, "goal must be a non-empty string"),
		webhookUrl: z
			.string()
			.url("webhookUrl must be a valid http/https URL")
			.refine(
				(value) => /^https?:/.test(value),
				"webhookUrl must be a valid http/https URL",
			),
		context: z.record(z.string(), z.unknown()).optional(),
		sessionKey: z.string().optional(),
		model: z.string().optional(),
		record: z.boolean().optional(),
		credentials: z
			.object({ cookie: z.string().optional() })
			.strict()
			.optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

type ScrapeRequest = z.infer<typeof RequestSchema>;

export interface AppDependencies {
	camofoxUrl: string;
	videoSecret: string;
	tasks: Record<string, TaskBuilder>;
	dispatch(job: AgentJob): Promise<void>;
	verifyVideo(filename: string, token: string, expiry: string): boolean;
	fileExists(path: string): Promise<void>;
	openVideo(path: string): NodeJS.ReadableStream;
	fetcher?: typeof fetch;
	createId?: () => string;
}

function createJob(
	type: string,
	request: ScrapeRequest,
	createId: () => string,
): AgentJob {
	return { jobId: createId(), type, ...request };
}

function errorMessage(error: z.ZodError): string {
	return error.issues[0]?.message ?? "Invalid request";
}

function isValidVideoFilename(filename: string): boolean {
	return /^[a-zA-Z0-9_-]+\.mp4$/.test(filename);
}

async function checkBrowserHealth(
	camofoxUrl: string,
	fetcher: typeof fetch,
): Promise<boolean> {
	const getHealth = async (): Promise<boolean> => {
		const response = await fetcher(`${camofoxUrl}/health`);
		const body = (await response.json()) as { browserConnected?: boolean };
		return body.browserConnected === true;
	};

	const connected = await getHealth();
	return connected || getHealth();
}

export function createApp(deps: AppDependencies) {
	const app = new Hono();
	const fetcher = deps.fetcher ?? fetch;
	const createId = deps.createId ?? randomUUID;

	app.get("/health", async (context) => {
		try {
			const connected = await checkBrowserHealth(deps.camofoxUrl, fetcher);
			return context.json(
				{ ok: connected, browserConnected: connected },
				connected ? 200 : 503,
			);
		} catch {
			return context.json({ ok: false, browserConnected: false }, 503);
		}
	});

	app.post("/scrape/:type", async (context) => {
		const type = context.req.param("type");
		if (!Object.hasOwn(deps.tasks, type)) {
			return context.json({ error: `Unknown task type: ${type}` }, 404);
		}

		const request = RequestSchema.safeParse(
			await context.req.json().catch(() => ({})),
		);
		if (!request.success) {
			return context.json({ error: errorMessage(request.error) }, 400);
		}

		const job = createJob(type, request.data, createId);
		void deps.dispatch(job);
		return context.json({ jobId: job.jobId }, 202);
	});

	app.get("/videos/:filename", async (context) => {
		const filename = context.req.param("filename");
		if (!isValidVideoFilename(filename)) {
			return context.json({ error: "Invalid filename" }, 400);
		}

		const token = context.req.query("token") ?? "";
		const expiry = context.req.query("expiry") ?? "";
		if (!deps.verifyVideo(filename, token, expiry)) {
			return context.json({ error: "Unauthorized" }, 401);
		}

		const path = `videos/${filename}`;
		try {
			await deps.fileExists(path);
			return new Response(deps.openVideo(path) as unknown as ReadableStream, {
				headers: { "Content-Type": "video/mp4" },
			});
		} catch {
			return context.json({ error: "Not found" }, 404);
		}
	});

	return app;
}
