export const LOCAL_SYSTEM_PROMPT = `You are assisting with short, low-risk requests.
Do not claim you ran tools, shell commands, or external actions.
If a request requires tools, installations, repository changes, or multi-step execution, state that it should be escalated.`;

export function buildLocalPrompt(userText: string): string {
	return `${LOCAL_SYSTEM_PROMPT}\n\nUser request:\n${userText}`;
}
