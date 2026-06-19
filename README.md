# Planafoot Agent Plugin

Connects AI agents to the Planafoot MCP server at <https://planafoot.com/mcp> and ships a shared `SKILL.md` that teaches Planafoot's planning, recovery, and undo flows. One skill, one MCP endpoint, per-agent manifests.

## Install (Claude Code)

From a checkout of this repo:

```text
/plugin marketplace add .
/plugin install planafoot@planafoot
```

Or straight from GitHub:

```text
/plugin marketplace add mindlace/planafoot-plugin
/plugin install planafoot@planafoot
```

Claude Code reads `.claude-plugin/plugin.json`, auto-discovers `.mcp.json` (a native remote MCP server) and the skill under `skills/planafoot/`, registers the server, and loads the skill. The first Planafoot tool call opens a browser for Google sign-in — use the same Google account as Planafoot. Tokens cache locally; later calls are silent.

## Install (Gemini CLI)

```text
gemini extensions install https://github.com/mindlace/planafoot-plugin
```

Gemini reads `gemini-extension.json`, registers the native remote MCP server, and loads the shared skill under `skills/`. OAuth is auto-discovered: the first tool call opens the browser for Google sign-in; tokens cache in `~/.gemini/mcp-oauth-tokens.json`.

## Install (Claude Desktop)

If your Desktop build has plugin support, install it the same way as Claude Code. Otherwise add the server to the `mcpServers` object in your config:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "planafoot": {
      "type": "http",
      "url": "https://planafoot.com/mcp"
    }
  }
}
```

Restart Desktop after editing. OAuth is the same browser flow. (Native remote MCP needs a recent Desktop build; very old builds without remote support are unsupported.)

## Requirements

- A Planafoot account at <https://planafoot.com>
- Claude Code, Gemini CLI, or a Claude Desktop build with remote-MCP support

## What's in here

- `.claude-plugin/plugin.json` — Claude plugin manifest (entry point for `/plugin install`)
- `.claude-plugin/marketplace.json` — local marketplace catalog (`/plugin marketplace add .`)
- `.mcp.json` — Claude's native remote MCP server entry
- `gemini-extension.json` — Gemini CLI extension manifest (native remote MCP)
- `skills/planafoot/SKILL.md` — the shared skill teaching Planafoot's tools

## Adding another agent

Support is additive: drop a new manifest at the repo root (e.g. `.codex-plugin/`) pointing at the same `skills/` tree and the same `https://planafoot.com/mcp` endpoint. No per-agent copies of the skill.
