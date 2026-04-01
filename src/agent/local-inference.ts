import { normalizeLocalInferenceError } from "./local-inference-error.ts";

export type LocalInferenceRequest = {
	baseUrl?: string;
	model: string;
	/** User message text */
	prompt: string;
	/** Optional system prompt - uses /api/chat when provided for better instruction following */
	system?: string;
	timeoutMs: number;
};

export type LocalInferenceResponse = {
	text: string;
	model: string;
};

export async function runLocalInference(request: LocalInferenceRequest): Promise<LocalInferenceResponse> {
	const baseUrl = request.baseUrl ?? "http://localhost:11434";
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), request.timeoutMs);

	try {
		// Use /api/chat when a system prompt is provided - better instruction following
		// than /api/generate which concatenates everything into a raw completion prompt.
		const useChat = Boolean(request.system);
		const endpoint = useChat ? `${baseUrl}/api/chat` : `${baseUrl}/api/generate`;
		const body = useChat
			? {
					model: request.model,
					messages: [
						{ role: "system", content: request.system },
						{ role: "user", content: request.prompt },
					],
					stream: false,
			  }
			: { model: request.model, prompt: request.prompt, stream: false };

		const response = await fetch(endpoint, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		if (!response.ok) {
			throw normalizeLocalInferenceError({
				model: request.model,
				error: new Error(`Ollama returned HTTP ${response.status}`),
				statusCode: response.status,
			});
		}

		const data = (await response.json()) as { response?: unknown; message?: { content?: unknown } };
		const text = useChat
			? data.message?.content
			: data.response;
		if (typeof text !== "string") {
			throw normalizeLocalInferenceError({
				model: request.model,
				error: new Error("Malformed Ollama response payload"),
				categoryHint: "malformed_response",
			});
		}

		return { text, model: request.model };
	} catch (error: unknown) {
		if (
			typeof error === "object" &&
			error !== null &&
			"kind" in error &&
			(error as { kind?: string }).kind === "local_inference_error"
		) {
			throw error;
		}

		throw normalizeLocalInferenceError({
			model: request.model,
			error,
		});
	} finally {
		clearTimeout(timeout);
	}
}
