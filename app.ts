import { randomUUID, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import type { AgentJob, TaskBuilder } from "./jobs/contracts.js";
import { fetchWithTimeout } from "./lib/abortable-fetch.js";
import {
	type OutboundUrlPolicyOptions,
	validateOutboundUrl,
} from "./outbound-url-policy.js";

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
		model: z.string().optional(),
		record: z.boolean().optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

type ScrapeRequest = z.infer<typeof RequestSchema>;

export interface AppDependencies {
	camofoxUrl: string;
	videoSecret: string;
	apiKey?: string;
	allowInsecureLocal?: boolean;
	camofoxTimeoutMs?: number;
	outboundPolicy?: OutboundUrlPolicyOptions;
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
	timeoutMs: number,
): Promise<boolean> {
	const getHealth = async (): Promise<boolean> => {
		const response = await fetchWithTimeout(
			fetcher,
			`${camofoxUrl}/health`,
			{},
			timeoutMs,
			"browser health check",
		);
		const body = (await response.json()) as { browserConnected?: boolean };
		return body.browserConnected === true;
	};

	const connected = await getHealth();
	return connected || getHealth();
}

function isAuthorized(header: string | undefined, apiKey: string): boolean {
	const prefix = "Bearer ";
	if (!header?.startsWith(prefix)) return false;
	const candidate = header.slice(prefix.length);
	if (candidate.length !== apiKey.length) return false;
	return timingSafeEqual(Buffer.from(candidate), Buffer.from(apiKey));
}

export function createApp(deps: AppDependencies) {
	const app = new Hono();
	const fetcher = deps.fetcher ?? fetch;
	const createId = deps.createId ?? randomUUID;
	const healthTimeoutMs = deps.camofoxTimeoutMs ?? 20_000;

	app.get("/health", async (context) => {
		try {
			const connected = await checkBrowserHealth(
				deps.camofoxUrl,
				fetcher,
				healthTimeoutMs,
			);
			return context.json(
				{ ok: connected, browserConnected: connected },
				connected ? 200 : 503,
			);
		} catch {
			return context.json({ ok: false, browserConnected: false }, 503);
		}
	});

	app.post("/scrape/:type", async (context) => {
		if (
			deps.apiKey &&
			!isAuthorized(context.req.header("Authorization"), deps.apiKey)
		) {
			return context.json({ error: "Unauthorized" }, 401);
		}
		if (!deps.apiKey && !deps.allowInsecureLocal) {
			return context.json({ error: "Unauthorized" }, 401);
		}
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
		try {
			const [url, webhookUrl] = await Promise.all([
				validateOutboundUrl(request.data.url, deps.outboundPolicy),
				validateOutboundUrl(request.data.webhookUrl, deps.outboundPolicy),
			]);
			request.data.url = url.toString();
			request.data.webhookUrl = webhookUrl.toString();
		} catch {
			return context.json(
				{ error: "URL is not allowed by outbound policy" },
				400,
			);
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
