/**
 * Friday Discord Bot
 * Routes Discord messages to Phantom via /trigger, reacts with emoji, replies in-channel.
 * Status API on port 3102.
 *
 * Runs as a standalone sidecar process (separate from the main Phantom service).
 * Phantom assigns the "social" role to messages whose conversationId starts with "discord:".
 *
 * Required env vars (see .env.example in repo root):
 *   DISCORD_BOT_TOKEN  - Discord bot token
 *   PHANTOM_TOKEN      - Phantom MCP bearer token
 *   PHANTOM_URL        - URL of the Phantom service (default: http://localhost:3100)
 *   STATUS_PORT        - Port for the status/health API (default: 3102)
 */

import { Client, Events, GatewayIntentBits, Partials, ChannelType } from "discord.js";
import type { Message } from "discord.js";

const DISCORD_TOKEN = process.env.DISCORD_BOT_TOKEN;
const PHANTOM_TOKEN = process.env.PHANTOM_TOKEN;
const PHANTOM_URL = process.env.PHANTOM_URL ?? "http://localhost:3100";
const STATUS_PORT = Number(process.env.STATUS_PORT ?? "3102");

if (!DISCORD_TOKEN) throw new Error("DISCORD_BOT_TOKEN is required");
if (!PHANTOM_TOKEN) throw new Error("PHANTOM_TOKEN is required");

const stats = {
	startTime: Date.now(),
	toolCalls: 0,
	lastActive: null as Date | null,
	logSize: 0,
};

function log(msg: string): void {
	console.log(`${new Date().toISOString()} ${msg}`);
	stats.logSize++;
}

// Stable conversation ID per Discord channel/DM so Phantom maintains session context.
// The "discord:" prefix causes Phantom to route this to the social role.
function conversationId(channelId: string): string {
	return `discord:${channelId}`;
}

function splitMessage(text: string, maxLen = 1990): string[] {
	if (text.length <= maxLen) return [text];
	const chunks: string[] = [];
	let remaining = text;
	while (remaining.length > 0) {
		// Try to split on newline boundary
		let cutAt = maxLen;
		const lastNewline = remaining.lastIndexOf("\n", maxLen);
		if (lastNewline > maxLen / 2) cutAt = lastNewline + 1;
		chunks.push(remaining.slice(0, cutAt));
		remaining = remaining.slice(cutAt);
	}
	return chunks;
}

async function sendToPhantom(text: string, channelId: string, author: string): Promise<string> {
	const resp = await fetch(`${PHANTOM_URL}/trigger`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${PHANTOM_TOKEN}`,
		},
		body: JSON.stringify({
			task: `[${author}]: ${text}`,
			source: "discord",
			conversationId: conversationId(channelId),
			delivery: { channel: "discord" }, // suppress default Slack delivery
		}),
		signal: AbortSignal.timeout(300_000), // 5 min timeout
	});

	if (!resp.ok) {
		const body = await resp.text().catch(() => "");
		throw new Error(`Phantom ${resp.status}: ${body}`);
	}

	const data = (await resp.json()) as { response?: string; status: string };
	stats.toolCalls++;
	stats.lastActive = new Date();
	return data.response ?? "(no response)";
}

const client = new Client({
	intents: [
		GatewayIntentBits.Guilds,
		GatewayIntentBits.GuildMessages,
		GatewayIntentBits.MessageContent,
		GatewayIntentBits.DirectMessages,
	],
	partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, (c) => {
	log(`Ready: ${c.user.tag}`);
});

client.on(Events.MessageCreate, async (message: Message) => {
	if (message.author.bot) return;

	const isDM = message.channel.type === ChannelType.DM;
	const isMentioned = client.user ? message.mentions.has(client.user) : false;
	if (!isDM && !isMentioned) return;

	// Strip bot mention from text
	let text = message.content;
	if (client.user) {
		text = text.replace(new RegExp(`<@!?${client.user.id}>`, "g"), "").trim();
	}
	if (!text) return;

	log(`[${message.author.tag}] ${text.slice(0, 120)}`);

	try {
		await message.react("⚙️");
	} catch {
		// Reaction may fail if missing permissions - non-fatal
	}

	try {
		const response = await sendToPhantom(text, message.channelId, message.author.username);
		const chunks = splitMessage(response);
		// First chunk as a reply, rest as follow-ups
		await message.reply({ content: chunks[0], allowedMentions: { repliedUser: false } });
		for (const chunk of chunks.slice(1)) {
			await message.channel.send(chunk);
		}
		await message.react("✅");
	} catch (err) {
		log(`Error: ${err}`);
		try {
			await message.reply("Something went wrong reaching Friday's brain. Try again.");
			await message.react("❌");
		} catch {
			// Ignore secondary failures
		}
	}
});

// Status API
Bun.serve({
	port: STATUS_PORT,
	fetch(req) {
		const url = new URL(req.url);

		if (url.pathname === "/status") {
			const uptimeMs = Date.now() - stats.startTime;
			const s = Math.floor(uptimeMs / 1000);
			const uptime =
				s < 60
					? `${s}s`
					: s < 3600
						? `${Math.floor(s / 60)}m ${s % 60}s`
						: `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
			return Response.json({
				online: client.isReady(),
				tag: client.user?.tag ?? "disconnected",
				uptime,
				uptimeMs,
				toolCalls: stats.toolCalls,
				lastActive: stats.lastActive?.toISOString() ?? null,
				logSize: stats.logSize,
			});
		}

		if (url.pathname === "/health") {
			return new Response(client.isReady() ? "ok" : "offline", {
				status: client.isReady() ? 200 : 503,
			});
		}

		return new Response("Not found", { status: 404 });
	},
});

log(`Status API on port ${STATUS_PORT}`);
client.login(DISCORD_TOKEN);
