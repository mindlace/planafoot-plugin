# planafoot-plugin: Gemini support + native MCP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the planafoot-plugin repo a multi-agent home — add a Gemini CLI extension that reuses the existing skill, and move both Claude and Gemini to native remote MCP (drop the `mcp-remote` shim).

**Architecture:** Per-agent manifests at the repo root (`.claude-plugin/`, `gemini-extension.json`) over one shared `skills/` tree. Both manifests point at the same native remote MCP endpoint. A dependency-free Node validator guards the manifests; a plugin-free Prettier config (matching planafoot's options) keeps `SKILL.md` byte-identical to planafoot's copy.

**Tech Stack:** JSON manifests, Markdown, Node 24 (ESM, `node:assert`), Prettier 3.x via `npx` (no installed deps).

## Global Constraints

- MCP endpoint (exact): `https://planafoot.com/mcp`
- Plugin / extension name: `planafoot`; version: `0.1.0`
- Claude `.mcp.json`: native remote — `{ "type": "http", "url": "https://planafoot.com/mcp" }`; **no** `command`/`args` (no `mcp-remote`)
- Gemini `gemini-extension.json`: native remote — `mcpServers.planafoot.httpUrl = "https://planafoot.com/mcp"`; **no** `GEMINI.md`
- `marketplace.json` plugin `source`: `"./"`
- Prettier (match planafoot's 3.x): `tabWidth 2`, `singleQuote true`, `trailingComma "none"`, `printWidth 100`; ignore `docs/` and `LICENSE`
- Repo stays dependency-free: no `package.json` / `node_modules`. Use `npx --yes prettier@3` and `node` directly.
- `skills/planafoot/SKILL.md` is the single source of skill content for all agents — never duplicated per-agent.
- **Out of scope:** OpenAI/Codex support; making the repo public (separate launch step).

---

### Task 1: Prettier config matching planafoot

**Files:**
- Create: `.prettierrc`
- Create: `.prettierignore`

**Interfaces:**
- Produces: a repo-root Prettier config later tasks rely on for `--check`/`--write`.

- [ ] **Step 1: Create `.prettierrc`**

```json
{
  "tabWidth": 2,
  "singleQuote": true,
  "trailingComma": "none",
  "printWidth": 100
}
```

(Plugin-free on purpose: planafoot's `prettier-plugin-svelte` / `prettier-plugin-tailwindcss` only affect `.svelte`/CSS, not the Markdown/JSON in this repo, so omitting them yields identical formatting without pulling dependencies.)

- [ ] **Step 2: Create `.prettierignore`**

```text
docs/
LICENSE
```

- [ ] **Step 3: Normalize existing files and verify clean**

Run: `npx --yes prettier@3 --write . && npx --yes prettier@3 --check .`
Expected: the `--write` may reformat nothing or a few files; the `--check` ends with `All matched files use Prettier code style!`

- [ ] **Step 4: Commit**

```bash
git add .prettierrc .prettierignore
git add -A
git commit -m "chore: add prettier config matching planafoot"
```

---

### Task 2: Native remote MCP for Claude + manifest validator

**Files:**
- Create: `scripts/validate-manifests.mjs`
- Modify: `.mcp.json`

**Interfaces:**
- Produces: `node scripts/validate-manifests.mjs` — exits non-zero with a clear message on any manifest violation; prints `All manifests valid.` on success. Task 3 extends it.

- [ ] **Step 1: Write the validator (Claude manifests only)**

Create `scripts/validate-manifests.mjs` (run from repo root):

```js
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const ENDPOINT = 'https://planafoot.com/mcp';
const read = (p) => JSON.parse(readFileSync(p, 'utf8'));

// .mcp.json — Claude native remote MCP, no mcp-remote shim
const mcp = read('.mcp.json');
const cms = mcp.mcpServers?.planafoot;
assert.ok(cms, '.mcp.json: missing mcpServers.planafoot');
assert.equal(cms.type, 'http', '.mcp.json: planafoot.type must be "http"');
assert.equal(cms.url, ENDPOINT, `.mcp.json: planafoot.url must be ${ENDPOINT}`);
assert.ok(!('command' in cms) && !('args' in cms), '.mcp.json: no command/args (drop mcp-remote)');

// .claude-plugin/plugin.json
const plugin = read('.claude-plugin/plugin.json');
assert.equal(plugin.name, 'planafoot', 'plugin.json: name must be "planafoot"');
assert.ok(plugin.version, 'plugin.json: version required');

// .claude-plugin/marketplace.json
const market = read('.claude-plugin/marketplace.json');
assert.equal(market.name, 'planafoot', 'marketplace.json: name must be "planafoot"');
const entry = market.plugins?.find((p) => p.name === 'planafoot');
assert.ok(entry, 'marketplace.json: missing planafoot plugin entry');
assert.equal(entry.source, './', 'marketplace.json: planafoot source must be "./"');

console.log('All manifests valid.');
```

- [ ] **Step 2: Run the validator to verify it fails**

Run: `node scripts/validate-manifests.mjs`
Expected: FAIL — `AssertionError [ERR_ASSERTION]: .mcp.json: planafoot.type must be "http"` (current `.mcp.json` uses `command`/`args` for `mcp-remote`).

- [ ] **Step 3: Rewrite `.mcp.json` to native remote**

Replace the entire file with:

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

> **Verify the schema key before committing:** confirm Claude Code's `.mcp.json` remote-server key is `type: "http"` (not `transport`) against current Claude Code docs (e.g. dispatch the `claude-code-guide` agent or check the plugins/MCP docs). Adjust the key and the validator's `cms.type` assertion together if the docs say otherwise.

- [ ] **Step 4: Run the validator to verify it passes**

Run: `node scripts/validate-manifests.mjs`
Expected: PASS — `All manifests valid.`

- [ ] **Step 5: Commit**

```bash
git add scripts/validate-manifests.mjs .mcp.json
git commit -m "feat: native remote MCP for Claude + manifest validator"
```

---

### Task 3: Gemini CLI extension

**Files:**
- Create: `gemini-extension.json`
- Modify: `scripts/validate-manifests.mjs`

**Interfaces:**
- Consumes: the validator from Task 2.
- Produces: a Gemini extension manifest reusing `skills/` and the shared endpoint.

- [ ] **Step 1: Extend the validator with Gemini assertions**

Append to `scripts/validate-manifests.mjs`, immediately before the final `console.log(...)` line:

```js
// gemini-extension.json — Gemini native remote MCP
const gem = read('gemini-extension.json');
assert.equal(gem.name, 'planafoot', 'gemini-extension.json: name must be "planafoot"');
assert.ok(typeof gem.version === 'string' && gem.version.length, 'gemini-extension.json: version required');
const gms = gem.mcpServers?.planafoot;
assert.ok(gms, 'gemini-extension.json: missing mcpServers.planafoot');
assert.equal(gms.httpUrl, ENDPOINT, `gemini-extension.json: planafoot.httpUrl must be ${ENDPOINT}`);
assert.ok(!('command' in gms) && !('args' in gms), 'gemini-extension.json: no command/args (native remote)');
```

- [ ] **Step 2: Run the validator to verify it fails**

Run: `node scripts/validate-manifests.mjs`
Expected: FAIL — `ENOENT: no such file or directory, open 'gemini-extension.json'`.

- [ ] **Step 3: Create `gemini-extension.json`**

```json
{
  "name": "planafoot",
  "version": "0.1.0",
  "mcpServers": {
    "planafoot": {
      "httpUrl": "https://planafoot.com/mcp"
    }
  }
}
```

- [ ] **Step 4: Run the validator to verify it passes**

Run: `node scripts/validate-manifests.mjs`
Expected: PASS — `All manifests valid.`

- [ ] **Step 5: Confirm formatting is clean**

Run: `npx --yes prettier@3 --check gemini-extension.json scripts/validate-manifests.mjs`
Expected: `All matched files use Prettier code style!` (run `--write` on either file if not, then re-check).

- [ ] **Step 6: Commit**

```bash
git add gemini-extension.json scripts/validate-manifests.mjs
git commit -m "feat: add Gemini CLI extension (native remote MCP)"
```

---

### Task 4: README — Claude + Gemini install, drop mcp-remote

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace `README.md` with the full content below**

````markdown
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
````

- [ ] **Step 2: Verify no `mcp-remote` remains and both agents are documented**

Run: `grep -c "mcp-remote" README.md; grep -c "Install (Gemini CLI)" README.md`
Expected: first line `0`, second line `1`.

- [ ] **Step 3: Verify formatting**

Run: `npx --yes prettier@3 --check README.md`
Expected: `All matched files use Prettier code style!` (run `--write` then re-check if needed).

- [ ] **Step 4: Commit**

```bash
git add README.md
git commit -m "docs: README for Claude + Gemini install on native remote MCP"
```

---

### Task 5: Create the `staging` branch (post-merge infra)

This runs **after this plan's PR merges to `main`** — `staging` should start life identical to the finished `main`. Plan B (planafoot subtree sync) consumes it.

- [ ] **Step 1: Create `staging` from the merged `main`**

```bash
git fetch origin
git push origin origin/main:refs/heads/staging
```

- [ ] **Step 2: Verify the branch exists**

Run: `git ls-remote --heads origin staging`
Expected: one line printing a SHA and `refs/heads/staging`.

---

## Self-Review

**Spec coverage:**
- Layout (per-agent manifests over shared `skills/`) → Tasks 3–4 (gemini manifest added; README documents the additive model). ✓
- Gemini support (`gemini-extension.json`, native `httpUrl`, reuse `skills/`, no `GEMINI.md`) → Task 3. ✓
- Native MCP for Claude (`.mcp.json` → `type: http`/`url`) → Task 2. ✓
- Prettier config matching planafoot (the `SKILL.md` ping-pong concern) → Task 1. ✓
- `staging` branch (bootstrap step 1) → Task 5. ✓
- Out of scope (OpenAI/Codex; public flip) → not implemented, by design. ✓
- **Deferred to Plan B (planafoot repo):** subtree adoption, `pre-push` hook, mirror-PR GHA, deploy-workflow wiring, branch protections, planafoot prettier/eslint ignore of `plugin/`. Not in this plan by scope split.

**Placeholder scan:** none — every file's full content is inline.

**Type/key consistency:** the validator's assertions (`type`/`url`, `httpUrl`, `source: "./"`, `name: "planafoot"`) match the manifest contents in Tasks 2–3 and the README snippets in Task 4. The Claude remote-key risk (`type` vs `transport`) is called out in Task 2 Step 3 with instruction to change the manifest and the assertion together.

## Follow-on

**Plan B — planafoot subtree sync** will be written for the *planafoot* repo after this plan executes (it depends on this repo being in final shape with a `staging` branch). It covers: `git rm plugin/` → `git subtree add --squash`; the husky `pre-push` split-rejoin-push hook; the mirror-PR GHA; `deploy-staging`/`deploy-prod` wiring via the mindlace-make-releases token; planafoot-plugin `staging` branch protection; and planafoot prettier/eslint ignore of `plugin/`. Its first task verifies the `split --rejoin` trailer choreography empirically before any workflow wiring.
