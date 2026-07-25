export interface AgentJob {
  jobId: string;
  type: string;
  url: string;
  goal: string;
  webhookUrl: string;
  context?: Record<string, unknown>;
  sessionKey?: string;
  model?: string;
  record?: boolean;
  credentials?: { cookie?: string };
  metadata?: Record<string, unknown>;
}

export interface TaskConfig {
  systemPrompt: string;
  processResult: (act: Record<string, unknown>) => unknown;
}

export interface AgentResult {
  ok: boolean;
  result: unknown;
  tokens: { prompt: number; completion: number; total: number };
  steps: number;
  durationMs: number;
  videoUrl?: string;
}

export type TaskBuilder = (job: AgentJob) => TaskConfig;
