# Planafoot Claude Plugin

This plugin connects Claude to the Planafoot MCP server at <https://planafoot.com/mcp> and ships a `SKILL.md` that teaches Claude how to drive Planafoot's planning, recovery, and undo flows.

## Install (Claude Code)

From a checkout of this repo, run these in Claude Code:

```text
/plugin marketplace add .
/plugin install planafoot@planafoot
```

Or, without a local checkout, point the marketplace straight at GitHub:

```text
/plugin marketplace add mindlace/planafoot-plugin
/plugin install planafoot@planafoot
```

The first command registers this repo's marketplace (`.claude-plugin/marketplace.json`); the second installs the `planafoot` plugin from it. Claude Code reads `.claude-plugin/plugin.json`, auto-discovers `.mcp.json` and the skill under `skills/planafoot/`, registers the MCP server, and loads the skill. First time you call a Planafoot tool, `mcp-remote` opens a browser for Google sign-in — use the same Google account you use for Planafoot. Tokens cache locally; subsequent invocations are silent.

## Install (Claude Desktop)

Claude Desktop reads its MCP configuration from:

- **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

If you have plugin support in your Desktop version, install the plugin the same way as Claude Code. Otherwise, merge the `planafoot` server entry from `.mcp.json` into the `mcpServers` object of your config:

```json
{
  "mcpServers": {
    "planafoot": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://planafoot.com/mcp"]
    }
  }
}
```

Restart Claude Desktop after editing. OAuth flow is the same as Claude Code.

## Requirements

- Node.js (for `npx`) on your PATH
- A Planafoot account at <https://planafoot.com>

## What's in here

- `.claude-plugin/plugin.json` — the Anthropic plugin manifest (metadata; entry point for `/plugin install`)
- `.claude-plugin/marketplace.json` — marketplace catalog so the plugin can be installed via `/plugin marketplace add .` + `/plugin install planafoot@planafoot`
- `.mcp.json` — the MCP server snippet (auto-discovered by Claude Code; reused by Claude Desktop)
- `skills/planafoot/SKILL.md` — the skill that teaches Claude how to use Planafoot's tools well

## Other agents

Support for additional agents is additive: each gets its own thin manifest directory at the repo root (e.g. `.codex-plugin/`, `.gemini-plugin/`) pointing at the shared `skills/` tree and reusing the same `.mcp.json` endpoint — no per-agent copies of the skill.
