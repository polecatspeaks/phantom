import type { PhantomConfig } from "../config/types.ts";

const BASE_LOCAL_PROMPT = `You are a helpful AI assistant. Answer concisely and directly.
Do not add security disclaimers, capability caveats, or boilerplate preambles.
Do not claim you ran tools, shell commands, or external actions.
If the request requires code execution, file changes, or multi-step work, say so briefly and stop.`;

export function buildLocalPrompt(userText: string, config?: Pick<PhantomConfig, "name">): string {
	const identity = config?.name
		? `Your name is ${config.name}.`
		: "";
	const systemPrompt = identity ? `${identity}\n${BASE_LOCAL_PROMPT}` : BASE_LOCAL_PROMPT;
	return `${systemPrompt}\n\nUser: ${userText}`;
}

