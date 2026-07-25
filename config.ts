import { isIP } from "node:net";
import { z } from "zod";

const EnvSchema = z.object({
	VIDEO_SECRET: z.string().min(1, "VIDEO_SECRET env var is required"),
	SCRAPER_API_KEY: z.preprocess(
		(value) =>
			typeof value === "string" && value.trim() === "" ? undefined : value,
		z.string().min(1).optional(),
	),
	SCRAPER_ALLOW_INSECURE_LOCAL: z
		.preprocess(
			(value) =>
				value === "true" || value === true
					? true
					: value === "false" || value === false || value === undefined
						? false
						: value,
			z.boolean(),
		)
		.default(false),
	SCRAPER_HOST: z.string().default("127.0.0.1"),
	CAMOFOX_URL: z.string().url().default("http://camofox-browser:9377"),
	OLLAMA_BASE_URL: z.string().url().default("https://ollama.com/v1"),
	OLLAMA_API_KEY: z.string().optional(),
	SCRAPER_WEBHOOK_SECRET: z.string().optional(),
	MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
	CAMOFOX_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
	WEBHOOK_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
	PORT: z.coerce.number().int().positive().default(3000),
	MAX_STEPS: z.coerce.number().int().positive().default(12),
});

export type Config = z.infer<typeof EnvSchema>;

function isLoopbackHost(host: string): boolean {
	const normalized = host.toLowerCase();
	return (
		normalized === "localhost" ||
		normalized === "::1" ||
		(isIP(normalized) === 4 && normalized.startsWith("127."))
	);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
	const config = EnvSchema.parse(env);
	if (!config.SCRAPER_ALLOW_INSECURE_LOCAL && !config.SCRAPER_API_KEY) {
		throw new Error(
			"SCRAPER_API_KEY env var is required unless SCRAPER_ALLOW_INSECURE_LOCAL=true",
		);
	}
	if (
		config.SCRAPER_ALLOW_INSECURE_LOCAL &&
		!isLoopbackHost(config.SCRAPER_HOST)
	) {
		throw new Error(
			"SCRAPER_HOST must be a loopback host when SCRAPER_ALLOW_INSECURE_LOCAL=true",
		);
	}
	return config;
}
