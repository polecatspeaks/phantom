import type { PhantomConfig } from "../config/types.ts";
import { DefaultLocalClassifier, type LocalClassifier } from "./local-classifier.ts";

export type InferenceRoute = "local" | "cloud";

export type InferenceRouteReason =
	| "forced_cloud"
	| "forced_local"
	| "mode_cloud"
	| "tool_required"
	| "high_consequence"
	| "cloud_keyword"
	| "too_complex"
	| "conversational"
	| "classifier_local"
	| "classifier_cloud"
	| "fallback_local";

export type InferenceDecision = {
	route: InferenceRoute;
	reason: InferenceRouteReason;
	tokenEstimate: number;
	effectiveMode: "auto" | "local" | "cloud";
	usedClassifier: boolean;
};

export type InferenceRoutingInput = {
	text: string;
	config: Pick<PhantomConfig, "inference">;
	metadata?: Record<string, unknown>;
	toolRequired?: boolean;
	highConsequence?: boolean;
	classifier?: LocalClassifier;
};

// Single-word cloud signals: tasks that imply tool use, long output, multi-step execution, or live lookup.
// Multi-word phrases (set up, walk through, look up, any news, heard about) handled with the trailing alternation.
const CLOUD_KEYWORD_RE =
	/\b(build|install|analy[sz]e|plan|execute|debug|refactor|deploy|migrate|setup|configure|create|explain|implement|generate|news|latest|current|update|search|lookup)\b|set\s+up\b|walk\s+(?:me\s+)?through\b|look\s+up\b|any\s+news\b|what'?s\s+happening\b|heard\s+about\b/i;
const CONVERSATIONAL_RE = /^(hi|hello|hey|thanks|thank you|how are you|what(?:'s| is) up|status\??)$/i;

export async function decideInferenceRoute(input: InferenceRoutingInput): Promise<InferenceDecision> {
	const mode = input.config.inference.mode;
	const forcedMode = extractForcedMode(input.metadata);
	const tokenEstimate = estimateTokens(input.text);
	const classifier = input.classifier ?? new DefaultLocalClassifier();

	if (forcedMode === "cloud") {
		return {
			route: "cloud",
			reason: "forced_cloud",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: false,
		};
	}

	if (forcedMode === "local") {
		// Safety flags still win over caller override - toolRequired/highConsequence are
		// system constraints, not heuristics, and must not be bypassed via metadata.
		if (input.toolRequired || input.highConsequence) {
			return {
				route: "cloud",
				reason: input.toolRequired ? "tool_required" : "high_consequence",
				tokenEstimate,
				effectiveMode: mode,
				usedClassifier: false,
			};
		}
		return {
			route: "local",
			reason: "forced_local",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: false,
		};
	}

	if (mode === "cloud") {
		return {
			route: "cloud",
			reason: "mode_cloud",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: false,
		};
	}

	if (input.toolRequired) {
		return {
			route: "cloud",
			reason: "tool_required",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: false,
		};
	}

	if (input.highConsequence) {
		return {
			route: "cloud",
			reason: "high_consequence",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: false,
		};
	}

	if (CLOUD_KEYWORD_RE.test(input.text)) {
		return {
			route: "cloud",
			reason: "cloud_keyword",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: false,
		};
	}

	if (tokenEstimate > input.config.inference.local_complexity_threshold) {
		return {
			route: "cloud",
			reason: "too_complex",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: false,
		};
	}

	if (CONVERSATIONAL_RE.test(input.text.trim())) {
		return {
			route: "local",
			reason: "conversational",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: false,
		};
	}

	const closeToThreshold =
		Math.abs(tokenEstimate - input.config.inference.local_complexity_threshold) <= 100 &&
		tokenEstimate >= Math.floor(input.config.inference.local_complexity_threshold * 0.6);

	if (closeToThreshold) {
		const result = await classifier.classify(input.text);
		return {
			route: result.route,
			reason: result.route === "local" ? "classifier_local" : "classifier_cloud",
			tokenEstimate,
			effectiveMode: mode,
			usedClassifier: true,
		};
	}

	return {
		route: "local",
		reason: "fallback_local",
		tokenEstimate,
		effectiveMode: mode,
		usedClassifier: false,
	};
}

export function estimateTokens(text: string): number {
	if (!text) return 0;
	return Math.ceil(text.length / 4);
}

function extractForcedMode(metadata?: Record<string, unknown>): "auto" | "local" | "cloud" | null {
	const forced = metadata?.forceInferenceMode;
	if (forced === "auto" || forced === "local" || forced === "cloud") {
		return forced;
	}
	return null;
}
