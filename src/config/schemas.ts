import { z } from "zod";

export const PeerConfigSchema = z.object({
	url: z.string().url(),
	token: z.string().min(1),
	description: z.string().optional(),
	enabled: z.boolean().default(true),
});

export const PhantomConfigSchema = z.object({
	name: z.string().min(1),
	domain: z.string().optional(),
	public_url: z.string().url().optional(),
	port: z.number().int().min(1).max(65535).default(3100),
	role: z.string().min(1).default("swe"),
	model: z.string().min(1).default("claude-sonnet-4-6"),
	inference: z
		.object({
			mode: z.enum(["auto", "local", "cloud"]).default("auto"),
			local_model: z.string().min(1).default("llama3.1:8b"),
			local_complexity_threshold: z.number().int().min(1).default(500),
			local_timeout_ms: z.number().int().min(1000).default(30000),
		})
		.default({}),
	effort: z.enum(["low", "medium", "high", "max"]).default("max"),
	max_budget_usd: z.number().min(0).default(0),
	daily_budget_usd: z.number().min(0).default(0),
	budget_increment_alert_usd: z.number().min(0).default(10),
	budget_alert_hour_eastern: z.number().int().min(0).max(23).default(8),
	timeout_minutes: z.number().min(1).default(240),
	// Quiet hours: scheduler jobs use local inference (toolRequired=false) during this window.
	// Times are HH:MM 24-hour strings. Range is inclusive start, exclusive end.
	quiet_hours: z
		.object({
			start: z.string().regex(/^\d{2}:\d{2}$/).default("23:00"),
			end: z.string().regex(/^\d{2}:\d{2}$/).default("07:00"),
			tz: z.string().default("America/New_York"),
		})
		.optional(),
	peers: z.record(z.string(), PeerConfigSchema).optional(),
	// Map conversationId prefixes and channelIds to role IDs.
	// Checked in order: conversationId prefix (e.g. "discord:") first, then channelId.
	channel_roles: z.record(z.string(), z.string()).optional(),
});

export const SlackChannelConfigSchema = z.object({
	enabled: z.boolean().default(false),
	bot_token: z.string().min(1),
	app_token: z.string().min(1),
	default_channel_id: z.string().optional(),
	default_user_id: z.string().optional(),
	owner_user_id: z.string().optional(),
});

export const TelegramChannelConfigSchema = z.object({
	enabled: z.boolean().default(false),
	bot_token: z.string().min(1),
});

export const EmailChannelConfigSchema = z.object({
	enabled: z.boolean().default(false),
	imap: z.object({
		host: z.string().min(1),
		port: z.number().int().min(1).default(993),
		user: z.string().min(1),
		pass: z.string().min(1),
		tls: z.boolean().default(true),
	}),
	smtp: z.object({
		host: z.string().min(1),
		port: z.number().int().min(1).default(587),
		user: z.string().min(1),
		pass: z.string().min(1),
		tls: z.boolean().default(false),
	}),
	from_address: z.string().email(),
	from_name: z.string().min(1).default("Phantom"),
});

export const WebhookChannelConfigSchema = z.object({
	enabled: z.boolean().default(false),
	secret: z.string().min(16),
	sync_timeout_ms: z.number().int().min(1000).default(25000),
});

export const ChannelsConfigSchema = z.object({
	slack: SlackChannelConfigSchema.optional(),
	telegram: TelegramChannelConfigSchema.optional(),
	email: EmailChannelConfigSchema.optional(),
	webhook: WebhookChannelConfigSchema.optional(),
});

export type ChannelsConfig = z.infer<typeof ChannelsConfigSchema>;

export const MemoryConfigSchema = z.object({
	qdrant: z
		.object({
			url: z.string().url().default("http://localhost:6333"),
		})
		.default({}),
	ollama: z
		.object({
			url: z.string().url().default("http://localhost:11434"),
			model: z.string().min(1).default("nomic-embed-text"),
		})
		.default({}),
	collections: z
		.object({
			episodes: z.string().min(1).default("episodes"),
			semantic_facts: z.string().min(1).default("semantic_facts"),
			procedures: z.string().min(1).default("procedures"),
		})
		.default({}),
	embedding: z
		.object({
			dimensions: z.number().int().positive().default(768),
			batch_size: z.number().int().positive().default(32),
		})
		.default({}),
	context: z
		.object({
			max_tokens: z.number().int().positive().default(8000),
			episode_limit: z.number().int().positive().default(5),
			fact_limit: z.number().int().positive().default(10),
			procedure_limit: z.number().int().positive().default(3),
		})
		.default({}),
});
