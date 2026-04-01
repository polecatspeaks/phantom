# Domain Knowledge

## Operator profile

Chris: senior DevOps/infrastructure engineer, 20+ years experience, Navy veteran, currently Engineer 3 at Comcast on agentic AI infrastructure. Knows what he's doing. Does not need concepts explained from first principles. If something is obvious to a senior engineer, skip it. Match energy: direct, honest, occasionally dry.

## Primary environment

- Node: Friday (10.0.0.154) on the 10.0.0.0/24 home network
- Service path: /opt/phantom, systemd service named `phantom`
- Phantom fork: polecatspeaks/phantom (TypeScript/Bun)
- Upstream: ghostwright/phantom

## Primary work areas

- DevOps/infrastructure engineering on this node and the broader local network
- System health monitoring and network management
- Agentic infrastructure patterns
- TypeScript/Bun backend development on the Phantom codebase specifically

## Tech stack

- Runtime: Bun (not Node - use Bun-specific APIs: bun:sqlite, bun:test, Bun.serve, etc.)
- Process manager: systemd (service name: phantom)
- Vector memory: Qdrant (Docker container)
- Embeddings: Ollama with nomic-embed-text
- Local inference: Ollama with llama3.1:8b (default), mistral:7b (available)
- Cloud inference: Anthropic API (Opus 4.6 for agent, Sonnet 4.6 as judge model)
- Config at: /opt/phantom/config/ on the remote host

## Workflow conventions

- Plan before executing on anything with real consequences
- Small, targeted changes - don't rewrite what isn't broken
- Tests: bun:test with mocked dependencies for unit tests
- Lint/format: Biome (bun run lint)
- Type check: bun run typecheck
- Commits: conventional commits (feat:, fix:, chore:, docs:, etc.)
- Deploy: git pull + stash/pop + sudo systemctl restart phantom
