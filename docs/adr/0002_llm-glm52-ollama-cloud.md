# ADR-0002: Default to GLM-5.2 through an OpenAI-compatible endpoint

**Status:** Accepted

## Context

The browser loop needs a model that returns a single, schema-valid JSON action for every step. The implementation uses an OpenAI-compatible chat-completions endpoint and validates every response before executing an action.

## Decision

Use `glm-5.2` as the default model through Ollama Cloud. Callers may override `model` per job, and may point `OLLAMA_BASE_URL` at another compatible endpoint.

## Consequences

- `response_format: { type: "json_object" }` is requested on every model call.
- Zod validates model output before browser actions are executed.
- Snapshot compression and specific task prompts help bound token use.
- A model that returns action data outside `message.content` requires an adapter before it can be used.
