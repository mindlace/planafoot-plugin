# planafoot-plugin: subtree sync + multi-agent (Gemini) design

Date: 2026-06-18
Status: Draft for review

## Goal

`planafoot-plugin` is the canonical, publishable home for the Planafoot agent
plugin(s). Today it ships a Claude Code plugin. This design:

1. Adds **Gemini CLI** support reusing the existing skill (no content duplication).
2. Moves **both** agents to **native remote MCP** (drop the `mcp-remote` npx shim).
3. Establishes the **sync model** between `planafoot` (where the skill is edited and
   validated against the live MCP tool surface) and `planafoot-plugin` (the
   published home), using a **squashed `git subtree`** so the plugin files live as
   plain vendored files in `planafoot` and flow out to `planafoot-plugin` on deploy.

Explicitly **out of scope** (deferred until after launch): OpenAI / Codex support.

## Repo layout (planafoot-plugin, final)

```
planafoot-plugin/
├── README.md                       # Claude + Gemini install sections
├── LICENSE
├── .claude-plugin/
│   ├── marketplace.json            # source: "./"
│   └── plugin.json
├── .mcp.json                       # Claude MCP — native remote (see below)
├── gemini-extension.json           # NEW — Gemini manifest
└── skills/
    └── planafoot/SKILL.md          # SHARED by both agents; drift-guarded in planafoot
```

Per-agent support is additive: each agent gets a thin manifest at the repo root
(`.claude-plugin/`, `gemini-extension.json`, later `.codex-plugin/` …), all pointing
at the one shared `skills/` tree. This matches the obra/superpowers and
antonbabenko/agent-plugins conventions: shared skills, per-agent manifest dotfiles —
not per-agent content subdirectories.

## Native remote MCP (both agents)

The Planafoot endpoint (`https://planafoot.com/mcp`) is a server-based MCP with OAuth
(Google sign-in). `mcp-remote` was only ever a stdio↔remote bridge for clients that
couldn't speak remote MCP. Both clients now support native remote MCP with OAuth, so
the shim is dropped.

**Claude (`.mcp.json`):**
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

**Gemini (`gemini-extension.json`):**
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

Gemini auto-discovers the OAuth endpoints, opens the browser on first tool call, and
caches tokens in `~/.gemini/mcp-oauth-tokens.json`. No `GEMINI.md` — the skill loads
on demand (always-on context would bloat every session), matching how the Claude
plugin relies on `SKILL.md` rather than always-on context.

## Source-of-truth & sync model

**Where editing happens:** the skill is edited in `planafoot`, because that is the
only place the drift guard (`src/lib/server/mcp/doc-drift.spec.ts`) can validate
`SKILL.md` against the live 35-tool surface defined in `planafoot/src/lib/server/mcp/`.

**How the files live in planafoot:** as a **squashed `git subtree`** at `plugin/`.
The files are real, vendored files in planafoot's tree — so a normal (shallow,
credential-free) checkout has them, and the drift guard reads
`plugin/skills/planafoot/SKILL.md` directly. No submodule, no checkout step, no fetch
credentials needed for CI to run the guard.

**The embedded SHA:** because the subtree is squashed, each sync commit in planafoot's
history carries the source pointer in its message:

```
git-subtree-dir: plugin
git-subtree-split: <planafoot-plugin commit sha>
```

So "which planafoot-plugin commit does this planafoot commit correspond to" is
recoverable **locally** from planafoot's own history —
`git log --grep="git-subtree-dir: plugin"` → read the latest `git-subtree-split:`.
No remote query, no mapping table, no re-split.

### Branch topology in planafoot-plugin

- `staging` — tracks planafoot `main`; fed by merging the per-PR feature branch.
- `main` — the last **released** plugin state; what end users install.
- per-PR feature branches — named identically to the planafoot PR branch; the PR
  target is `staging`.

### Mechanism (no worktree:init; hook + PR correspondence)

The skill is edited as plain `plugin/` files in any planafoot branch — no special
worktree setup. The sync is driven by a hook and mirrored PRs:

1. **planafoot `pre-push` hook (husky):** when the pushed range touches `plugin/`,
   run `git subtree split --prefix=plugin --rejoin` (the `--rejoin` writes the
   `git-subtree-split` trailer into planafoot's history so prod can read it later) and
   push the split tip to `planafoot-plugin@<same-branch-name>`. Pre-push, not a commit
   hook, so we don't hit the network on every local commit.
2. **planafoot PR → mirrored planafoot-plugin PR:** a planafoot GHA, on any PR whose
   diff touches `plugin/`, ensures a `planafoot-plugin` PR exists from the same-named
   branch into `staging` (created via the mindlace-make-releases token). This is
   item 0: plugin changes always have a corresponding planafoot-plugin PR.
3. **Collision protection:**
   - planafoot-plugin: `staging` branch protection **rejects merges with conflicts /
     out-of-date branches**, so the published history can't be force-collided.
   - planafoot: a `plugin-ok` required check that blocks merge if the planafoot-plugin
     branch would conflict with `staging`. *Likely redundant* — a textual `plugin/`
     conflict would also conflict in planafoot `main` — so this check is a belt-and-
     suspenders guard and may be dropped if it proves to add no signal.

### Flow

```mermaid
sequenceDiagram
    participant Dev as planafoot branch
    participant PF as planafoot main
    participant PP as planafoot-plugin
    Dev->>Dev: 1. edit planafoot code and plugin files
    Dev->>PP: 2a. pre-push hook splits subtree and pushes same-named branch
    Dev->>PF: 2b. push planafoot branch and open PR
    PF->>PP: 2c. GHA opens mirrored PR into staging
    Note over PF,PP: drift guard validates SKILL.md, collision checks gate merges
    PF->>PF: 3. planafoot PR merges to main
    PP->>PP: 3. deploy-staging merges same-named PR into staging
    Note over PF: 4. release-please cuts a release
    PF->>PP: 5. deploy-prod reads git-subtree-split sha, promotes main plus marker
```

**deploy-staging** (`on: push → main`): merge the same-named planafoot-plugin PR into
`staging` (the branch name matches the just-merged planafoot PR). Branch protection
guarantees no-collision merges.

**deploy-prod** (`on: release: published`): the job already checks out the release tag
to build the Cloudflare worker. Add `fetch-depth: 0`, read `git-subtree-split` from
the released history (`git log --grep="git-subtree-dir: plugin"`), and promote
`planafoot-plugin@main` to that SHA, then add a `chore: release vX.Y.Z` marker commit.
Because the released tag is an ancestor of main, its recorded plugin SHA is an ancestor
of `staging` → the push to `main` fast-forwards.

## Credentials

Reuse the **mindlace-make-releases** GitHub App — already wired into
`release-please.yml` via `vars.RELEASE_PLEASE_APP_ID` +
`secrets.RELEASE_PLEASE_APP_PRIVATE_KEY` through `actions/create-github-app-token`,
and it already has read/write on `planafoot-plugin`. The staging and prod deploy
workflows mint a token the same way to push to `planafoot-plugin`. No new secrets.

## Distribution / visibility

`planafoot-plugin` is currently **private**. CI does not need it public (subtree
vendors the files into planafoot; only the outbound push needs the token, which it
has). End-user installation (`/plugin marketplace add mindlace/planafoot-plugin`,
`gemini extensions install …`) **does** require it to be public — a deliberate flip
"as soon as we want," tracked as a launch step, not part of this work.

## Bootstrap / migration sequence

Each step is its own worktree + PR.

1. **planafoot-plugin — reach final content** (this repo):
   - Add `gemini-extension.json` (native `httpUrl`).
   - Modernize `.mcp.json` to native `type: http` / `url`.
   - Update `README.md` (Claude + Gemini install; drop `mcp-remote` mentions).
   - Create the `staging` branch.
2. **planafoot — adopt the subtree + wire deploys**:
   - Replace the existing plain `plugin/` directory with a squashed subtree of
     `planafoot-plugin` (`git rm -r plugin` → `git subtree add --prefix=plugin
     --squash <planafoot-plugin> main`). Net new files under `plugin/`:
     `gemini-extension.json`, `LICENSE`. Drift-guard path unchanged.
   - Add a husky **`pre-push` hook**: when the range touches `plugin/`, run
     `git subtree split --prefix=plugin --rejoin` and push the tip to
     `planafoot-plugin@<current-branch>`.
   - Add a **mirror-PR GHA**: on a planafoot PR touching `plugin/`, ensure a
     `planafoot-plugin` PR exists from the same-named branch into `staging`.
   - Add the **`plugin-ok`** required check (collision guard; may be dropped if
     redundant with planafoot `main` conflicts).
   - Wire **deploy-staging** to merge the same-named planafoot-plugin PR into
     `staging`, and **deploy-prod** to promote `main` to the released
     `git-subtree-split` SHA — both via the mindlace-make-releases token.
   - Decide prettier/eslint ownership of `plugin/`: `SKILL.md` stays prettier-checked
     in planafoot (the drift remediation already runs
     `prettier --check plugin/skills/planafoot/SKILL.md`), so planafoot-plugin must
     carry a matching prettier config; the rest of `plugin/` is ignored by planafoot's
     formatters to avoid ping-pong.

3. **planafoot-plugin — branch protection**: protect `staging` to reject merges with
   conflicts / out-of-date branches.

## Drift guard interaction

`doc-drift.spec.ts:88` reads `plugin/skills/planafoot/SKILL.md`. With the squashed
subtree those are plain in-tree files, so the guard runs unchanged on a normal
checkout. The skill is edited in planafoot, validated by the guard, then flows out —
keeping the published skill always in sync with the live tool surface.

## Open items to validate in the plan (with real git runs)

- The `pre-push` hook choreography: confirm `git subtree split --prefix=plugin
  --rejoin` writes a `git-subtree-split` trailer that `deploy-prod` can grep, and that
  the pushed branch tip is what staging later merges. Subtree plumbing is finicky —
  verify empirically, not by assumption.
- Fast-forward discipline: per-PR branches push from a base that keeps staging→main
  promotions linear; confirm the first promotion after bootstrap fast-forwards.
- Mirror-PR lifecycle: branch naming collisions, what happens when a planafoot PR is
  closed without merge (orphan planafoot-plugin PR cleanup), and reachability of a
  feature branch's commit until `staging` has merged it.
- Whether the `plugin-ok` check earns its keep or is fully redundant with planafoot
  `main` conflicts.

## Out of scope

- OpenAI / Codex plugin (deferred until after launch).
- Making `planafoot-plugin` public (separate launch step).
