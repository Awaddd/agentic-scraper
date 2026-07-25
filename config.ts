import { z } from "zod";

const EnvSchema = z.object({
	VIDEO_SECRET: z.string().min(1, "VIDEO_SECRET env var is required"),
	CAMOFOX_URL: z.string().url().default("http://camofox-browser:9377"),
	OLLAMA_BASE_URL: z.string().url().default("https://ollama.com/v1"),
	OLLAMA_API_KEY: z.string().optional(),
	SCRAPER_WEBHOOK_SECRET: z.string().optional(),
	PORT: z.coerce.number().int().positive().default(3000),
	MAX_STEPS: z.coerce.number().int().positive().default(12),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	return EnvSchema.parse(env);
}
