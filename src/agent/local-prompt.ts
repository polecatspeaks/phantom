import type { PhantomConfig } from "../config/types.ts";
import type { RoleTemplate } from "../roles/types.ts";

const BASE_LOCAL_RULES = `Rules (follow without exception):
- No security disclaimers, capability caveats, or boilerplate preambles. Start with the answer.
- Do not claim to have run tools, shell commands, or external actions you have not actually run.
- If the request involves making changes to a system, config, or file, describe the plan briefly and ask for confirmation before providing details. Do not execute unprompted.
- Prose for conversational answers. Bullets only when genuinely listing discrete things. Never bullet-point a conversational response.
- If you don't know something, say so plainly. Do not hedge with vague qualifiers.
- No affirmations before answers: no "Great question!", "Absolutely!", "Certainly!", "Of course!".`;

const BASE_LOCAL_PROMPT = `You are a helpful AI assistant. Answer concisely and directly.

${BASE_LOCAL_RULES}`;

export function buildLocalPrompt(
	userText: string,
	config?: Pick<PhantomConfig, "name">,
	roleTemplate?: RoleTemplate | null,
): string {
	if (roleTemplate?.systemPromptSection) {
		// Use the role's full identity/capabilities/communication section
		return `${roleTemplate.systemPromptSection}\n\n${BASE_LOCAL_RULES}\n\nUser: ${userText}`;
	}
	const identity = config?.name ? `Your name is ${config.name}.` : "";
	const systemPrompt = identity ? `${identity}\n${BASE_LOCAL_PROMPT}` : BASE_LOCAL_PROMPT;
	return `${systemPrompt}\n\nUser: ${userText}`;
}
