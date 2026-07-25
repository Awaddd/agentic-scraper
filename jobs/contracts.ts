export interface AgentJob {
	jobId: string;
	type: string;
	url: string;
	goal: string;
	webhookUrl: string;
	context?: Record<string, unknown>;
	model?: string;
	record?: boolean;
	metadata?: Record<string, unknown>;
}

export interface TaskConfig {
	systemPrompt: string;
	processResult: (act: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface AgentMetrics {
	result: unknown;
	tokens: { prompt: number; completion: number; total: number };
	steps: number;
	durationMs: number;
	videoUrl?: string;
}

export interface AgentSuccess extends AgentMetrics {
	ok: true;
	result: unknown;
	videoUrl?: string;
}

export interface AgentFailure extends AgentMetrics {
	ok: false;
	result: null;
	error: string;
	videoUrl?: never;
}

export type AgentResult = AgentSuccess | AgentFailure;

export type TaskBuilder = (job: AgentJob) => TaskConfig;
