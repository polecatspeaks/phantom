# Architecture

Phantom is a single Bun process that runs on a VM. It combines an agent runtime, memory system, self-evolution engine, MCP server, and multi-channel communication into one process.

## System Diagram

```
              External Clients (Claude Code, dashboards, other Phantoms)
                        |
              MCP (Streamable HTTP, Bearer auth)
                        |
+------------------------------------------------------------------+
|                   PHANTOM PROCESS (Bun)                          |
|                                                                  |
|  HTTP Server (Bun.serve, port 3100)                              |
|    /health  /mcp  /webhook                                       |
|        |       |       |                                         |
|  +-----v-+ +--v---+ +-v--------+                                |
|  |Channel| | MCP  | | Auth     |                                |
|  |Router | |Server| | Middleware|                                |
|  +---+---+ +--+---+ +----------+                                |
|      |        |                                                  |
|  +---v--------v-----------+                                      |
|  |     Session Manager    |                                      |
|  +---+----------------+---+                                      |
|      |                |                                          |
|  +---v---------+ +----v-----------+                              |
|  |Agent Runtime| |Prompt Assembler|                              |
|  |query() wrap | |base+role+evolved|                             |
|  +---+---------+ +----+-----------+                              |
|      |                |                                          |
|  +---v---------+ +----v-----------+                              |
|  |Memory System| |Self-Evolution  |                              |
|  |Qdrant+Ollama| |6-step pipeline |                              |
|  +-------------+ +----+-----------+                              |
|                       |                                          |
|  +--------------------v----------+                               |
|  |      Evolved Config (files)   |                               |
|  | constitution.md | persona.md  |                               |
|  | domain-knowledge.md           |                               |
|  | strategies/                   |                               |
|  +-------------------------------+                               |
+------------------------------------------------------------------+
         |           |
   +-----v---+ +----v----+
   |  Qdrant | | Ollama  |
   | (Docker)| | (system)|
   +---------+ +---------+
         |
   +-----v-----------+
   | SQLite (Bun)     |
   | sessions, tasks, |
   | metrics, costs   |
   +------------------+
```

## Components

### HTTP Server

`src/core/server.ts` - Bun.serve() on port 3100. Three routes:
- `/health` - JSON health status (status, uptime, version, channels, memory, evolution)
- `/mcp` - MCP Streamable HTTP endpoint
- `/webhook` - Inbound webhook receiver

### Channel Router

`src/channels/router.ts` - Multiplexes messages from all connected channels. Each channel implements the `Channel` interface: `connect()`, `disconnect()`, `send()`, `onMessage()`.

Channels: Slack (Socket Mode), Telegram (long polling), Email (IMAP/SMTP), Webhook (HTTP), CLI (readline).

### Agent Runtime

`src/agent/runtime.ts` - Wraps the Claude Agent SDK `query()` function. Handles session management, hooks (file tracking, command blocking), and event streaming (thinking, tool_use, error).

Before invoking the SDK, the runtime calls the inference router to decide whether the request should run on the local Ollama tier or the cloud (Anthropic) tier. See **Tiered Inference Router** below.

### Tiered Inference Router

`src/agent/inference-router.ts` - Pure routing decisioner. Selects between local (Ollama) and cloud (Anthropic) execution before `query()` is called. No SDK calls, fully mockable.

**Routing modes** (set via `INFERENCE_MODE` or `config/phantom.yaml`):
- `cloud` - Always use Anthropic. Identical to pre-router behaviour.
- `local` - Prefer local Ollama; fall back to cloud on failure.
- `auto` (default) - Heuristics first: token estimate, `toolRequired`, `highConsequence`, keyword signals. Ambiguous cases use `DefaultLocalClassifier`.

**Decision factors** (heuristics applied in order):
1. Per-request metadata override (`forceInferenceMode`)
2. Config-level mode forcing (`cloud` or `local`)
3. `toolRequired` or `highConsequence` flags -> cloud
4. Cloud keyword signals (`build`, `install`, `analyze`, `plan`, `execute`, `debug`, `refactor`, `deploy`, `migrate`) -> cloud
5. Token estimate above `LOCAL_COMPLEXITY_THRESHOLD` (default 500) -> cloud
6. Classifier returns `cloud` with confidence above threshold -> cloud
7. Everything else -> local

**Local path** (`src/agent/local-inference.ts`): POSTs to Ollama `http://localhost:11434/api/generate` with `AbortController` timeout. All Ollama errors are normalized to `LocalInferenceError` (category: `timeout`, `service_unavailable`, `model_not_found`, `malformed_response`, `network`, `unknown`). Any local failure triggers an automatic cloud fallback.

**Cost semantics**: Local-only responses create no cost event. Local-to-cloud fallback records only the final cloud cost.

**Judge isolation**: Self-evolution judges (`src/evolution/judges/client.ts`) use the raw Anthropic SDK directly and are never routed through the inference router. This preserves cross-model evaluation integrity.

### Prompt Assembler

`src/agent/prompt-assembler.ts` - Builds the system prompt from layers:
1. Base identity ("You are {name}, an autonomous AI co-worker...")
2. Role section (from the role template YAML)
3. Onboarding prompt (during first-run only)
4. Evolved config (constitution, persona, domain knowledge, strategies)
5. Instructions
6. Memory context (recent episodes, relevant facts)

### Memory System

`src/memory/system.ts` - Three-tier vector memory backed by Qdrant:
- **Episodic** - Session transcripts and outcomes, stored as embeddings
- **Semantic** - Accumulated facts with contradiction detection
- **Procedural** - Learned workflows and procedures

Embeddings via Ollama (nomic-embed-text, 768d vectors). Hybrid search using dense vectors + BM25 sparse vectors with RRF fusion.

### Self-Evolution Engine

`src/evolution/engine.ts` - 6-step pipeline that runs after each session:
1. **Observation Extraction** - identify corrections, preferences, domain facts
2. **Self-Critique** - review session against current config
3. **Config Delta Generation** - propose minimal config changes
4. **5-Gate Validation** - constitution, regression, size, drift, safety
5. **Application** - approved changes written to files, version bumped
6. **Consolidation** - periodic observation compression and pattern extraction

LLM judges (Sonnet) available for gates when API key is set. Falls back to heuristic validation.

### MCP Server

`src/mcp/server.ts` - Exposes Phantom's capabilities as MCP tools and resources. Bearer token auth with SHA-256 hashing. Three scopes (read, operator, admin). Rate limiting per client. Full audit logging.

8 universal tools + role-specific tools + dynamic tools registered at runtime.

### Role System

`src/roles/` - YAML-first role definitions. Each role provides a system prompt section, onboarding questions, MCP tool definitions, evolution focus priorities, and feedback signal mappings.

## Data Flow

1. Message arrives via channel (Slack mention, webhook POST, etc.)
2. Channel router normalizes to `InboundMessage`
3. Session manager finds or creates a session
4. Prompt assembler builds the full system prompt
5. Inference router decides: local (Ollama) or cloud (Anthropic)
6. Agent runtime runs on local tier, or calls `query()` for cloud; falls back to cloud on local failure
7. Response routed back through the originating channel
8. Memory consolidation runs (non-blocking)
9. Evolution pipeline runs (non-blocking)

## Technology Stack

| Component | Technology |
|-----------|------------|
| Runtime | Bun (TypeScript, no compilation) |
| Agent | @anthropic-ai/claude-agent-sdk (Opus 4.6) |
| Vector DB | Qdrant (Docker) |
| Embeddings | Ollama (nomic-embed-text) |
| State DB | SQLite (Bun built-in) |
| Channels | Slack Bolt, Telegraf, ImapFlow, Nodemailer |
| Config | YAML + Zod validation |
| Process | systemd (on Specter VMs) |

## File Structure

```
src/
  agent/           - Runtime, prompt assembler, hooks, cost tracking, inference router, local adapter
  channels/        - Slack, Telegram, Email, Webhook, CLI, status reactions
  cli/             - CLI commands (init, start, doctor, token, status)
  config/          - YAML config loaders, Zod schemas
  core/            - HTTP server, graceful shutdown
  db/              - SQLite connection, migrations
  evolution/       - Engine, reflection, validation, versioning, judges
  mcp/             - MCP server, tools, auth, transport, dynamic tools, peers
  memory/          - Qdrant client, episodic/semantic/procedural stores
  onboarding/      - First-run detection, state, prompt injection
  roles/           - Role types, loader, registry
  shared/          - Shared patterns
config/
  phantom.yaml     - Main config
  channels.yaml    - Channel config (env var substitution)
  mcp.yaml         - MCP auth tokens
  roles/           - Role YAML definitions
phantom-config/    - Evolved config (grows over time)
data/              - SQLite database
docs/              - Documentation
```
