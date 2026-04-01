import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { loadMemoryConfig } from "../config.ts";

describe("loadMemoryConfig env overrides", () => {
	const origQdrant = process.env.QDRANT_URL;
	const origOllama = process.env.OLLAMA_URL;
	const origModel = process.env.EMBEDDING_MODEL;

	beforeEach(() => {
		delete process.env.QDRANT_URL;
		delete process.env.OLLAMA_URL;
		delete process.env.EMBEDDING_MODEL;
	});

	afterEach(() => {
		if (origQdrant !== undefined) process.env.QDRANT_URL = origQdrant;
		else delete process.env.QDRANT_URL;
		if (origOllama !== undefined) process.env.OLLAMA_URL = origOllama;
		else delete process.env.OLLAMA_URL;
		if (origModel !== undefined) process.env.EMBEDDING_MODEL = origModel;
		else delete process.env.EMBEDDING_MODEL;
	});

	test("uses YAML defaults when no env vars set", () => {
		const config = loadMemoryConfig();
		expect(config.qdrant.url).toBe("http://localhost:6333");
		expect(config.ollama.url).toBe("http://localhost:11434");
		expect(config.ollama.model).toBe("nomic-embed-text");
	});

	test("QDRANT_URL env var overrides YAML config", () => {
		process.env.QDRANT_URL = "http://qdrant:6333";
		const config = loadMemoryConfig();
		expect(config.qdrant.url).toBe("http://qdrant:6333");
	});

	test("OLLAMA_URL env var overrides YAML config", () => {
		process.env.OLLAMA_URL = "http://ollama:11434";
		const config = loadMemoryConfig();
		expect(config.ollama.url).toBe("http://ollama:11434");
	});

	test("EMBEDDING_MODEL env var overrides YAML config", () => {
		process.env.EMBEDDING_MODEL = "mxbai-embed-large";
		const config = loadMemoryConfig();
		expect(config.ollama.model).toBe("mxbai-embed-large");
	});

	test("env vars override for missing YAML file (defaults path)", () => {
		process.env.QDRANT_URL = "http://qdrant:6333";
		process.env.OLLAMA_URL = "http://ollama:11434";
		const config = loadMemoryConfig("config/nonexistent.yaml");
		expect(config.qdrant.url).toBe("http://qdrant:6333");
		expect(config.ollama.url).toBe("http://ollama:11434");
	});

	test("non-memory fields are preserved when env vars set", () => {
		process.env.QDRANT_URL = "http://qdrant:6333";
		const config = loadMemoryConfig();
		expect(config.collections.episodes).toBe("episodes");
		expect(config.embedding.dimensions).toBe(768);
		expect(config.context.max_tokens).toBe(50000);
	});
});
