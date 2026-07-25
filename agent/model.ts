export interface Message {
	role: "system" | "user" | "assistant";
	content: string;
}
export interface Model {
	complete(
		messages: Message[],
		model: string,
	): Promise<{
		content: string;
		usage: { prompt_tokens: number; completion_tokens: number };
	}>;
}

export interface DiagnosticLogger {
	warn(bindings: object, message: string): void;
}

export function createModel(
	baseUrl: string,
	apiKey: string | undefined,
	fetcher: typeof fetch = fetch,
	logger?: DiagnosticLogger,
): Model {
	const once = async (messages: Message[], model: string) => {
		const res = await fetcher(`${baseUrl}/chat/completions`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${apiKey}`,
				Connection: "close",
			},
			body: JSON.stringify({
				model,
				messages,
				temperature: 0,
				stream: false,
				response_format: { type: "json_object" },
			}),
		});
		if (!res.ok)
			throw new Error(
				`llm -> ${res.status}: ${(await res.text()).slice(0, 400)}`,
			);
		const data = JSON.parse(await res.text()) as {
			choices?: Array<{ message: { content: string } }>;
			usage?: { prompt_tokens: number; completion_tokens: number };
		};
		return {
			content: data.choices?.[0]?.message?.content ?? "",
			usage: data.usage ?? { prompt_tokens: 0, completion_tokens: 0 },
		};
	};
	return {
		async complete(messages, model) {
			try {
				return await once(messages, model);
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				logger?.warn(
					{ error: error.message },
					"llm response failed to parse, retrying once",
				);
				return once(messages, model);
			}
		},
	};
}
