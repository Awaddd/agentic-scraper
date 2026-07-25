import { describe, expect, it, vi } from "vitest";
import { createModel } from "./model.js";

describe("model transport", () => {
	it("retries malformed JSON once and preserves request fields", async () => {
		const logger = { warn: vi.fn() };
		const fetcher = vi
			.fn()
			.mockResolvedValueOnce(new Response("{bad"))
			.mockResolvedValueOnce(
				new Response(
					JSON.stringify({
						choices: [{ message: { content: "{}" } }],
						usage: { prompt_tokens: 2, completion_tokens: 3 },
					}),
				),
			);
		const model = createModel("https://ollama.test/v1", "key", fetcher, logger);
		await expect(
			model.complete([{ role: "system", content: "s" }], "glm"),
		).resolves.toMatchObject({ usage: { prompt_tokens: 2 } });
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(
			{ error: expect.stringContaining("JSON") },
			"llm response failed to parse, retrying once",
		);
		expect(
			JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string),
		).toMatchObject({
			model: "glm",
			temperature: 0,
			stream: false,
			response_format: { type: "json_object" },
		});
	});
	it("does not extend the model deadline for its malformed-JSON retry", async () => {
		const fetcher = vi.fn().mockResolvedValue(new Response("{"));
		let clock = 0;
		const model = createModel(
			"https://ollama.test/v1",
			"key",
			fetcher,
			undefined,
			30,
			() => {
				const value = clock;
				clock = 30;
				return value;
			},
		);
		await expect(
			model.complete([{ role: "system", content: "s" }], "glm"),
		).rejects.toBeInstanceOf(SyntaxError);
		expect(fetcher).toHaveBeenCalledOnce();
	});
});
