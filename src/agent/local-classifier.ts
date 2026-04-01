export type LocalClassifierResult = {
	route: "local" | "cloud";
	confidence: number;
	reason: string;
};

export interface LocalClassifier {
	classify(text: string): Promise<LocalClassifierResult>;
}

export class DefaultLocalClassifier implements LocalClassifier {
	async classify(_text: string): Promise<LocalClassifierResult> {
		// Conservative default: prefer local when no strong cloud signals were detected.
		return { route: "local", confidence: 0.5, reason: "default_local_classifier" };
	}
}
