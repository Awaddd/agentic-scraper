import { buildWebhookPayload } from "../callbacks/webhook.js";
import type {
	AgentJob,
	AgentResult,
	TaskBuilder,
	TaskConfig,
} from "./contracts.js";

const EMPTY_TOKENS = { prompt: 0, completion: 0, total: 0 };

export interface DispatchDependencies {
	tasks: Record<string, TaskBuilder>;
	runAgent(job: AgentJob, task: TaskConfig): Promise<AgentResult>;
	deliver(url: string, payload: unknown): Promise<void>;
	logger: { error(bindings: object, message: string): void };
}

function getTask(
	job: AgentJob,
	tasks: Record<string, TaskBuilder>,
): TaskConfig {
	if (!Object.hasOwn(tasks, job.type)) {
		throw new Error(`Unknown task type: ${job.type}`);
	}

	const buildTask = tasks[job.type];
	if (!buildTask) {
		throw new Error(`Task type has no builder: ${job.type}`);
	}

	return buildTask(job);
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function deliverPayload(
	job: AgentJob,
	payload: unknown,
	deps: DispatchDependencies,
): Promise<void> {
	try {
		await deps.deliver(job.webhookUrl, payload);
	} catch (error) {
		deps.logger.error({ jobId: job.jobId, error }, "callback delivery failed");
	}
}

async function deliverFailure(
	job: AgentJob,
	error: string,
	deps: DispatchDependencies,
): Promise<void> {
	const payload = buildWebhookPayload({
		jobId: job.jobId,
		type: job.type,
		ok: false,
		result: null,
		tokens: EMPTY_TOKENS,
		steps: 0,
		durationMs: 0,
		error,
		metadata: job.metadata,
	});

	await deliverPayload(job, payload, deps);
}

export async function dispatchJob(
	job: AgentJob,
	deps: DispatchDependencies,
): Promise<void> {
	try {
		const result = await deps.runAgent(job, getTask(job, deps.tasks));
		const payload = buildWebhookPayload({
			jobId: job.jobId,
			type: job.type,
			ok: true,
			result: result.result,
			tokens: result.tokens,
			steps: result.steps,
			durationMs: result.durationMs,
			videoUrl: result.videoUrl,
			metadata: job.metadata,
		});

		await deliverPayload(job, payload, deps);
	} catch (error) {
		const message = errorMessage(error);
		deps.logger.error({ jobId: job.jobId, error: message }, "job failed");
		await deliverFailure(job, message, deps);
	}
}
