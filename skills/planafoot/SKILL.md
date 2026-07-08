---
name: planafoot
description: Use when the user wants to plan, restructure, or recover work in Plan afoot. Triggers on "plan afoot", "plan", "quest", "tasks", "planafoot", "what changed", "bring back", or natural undo requests.
---

# Plan afoot

Plan afoot helps people who find it hard to plan ahead turn intentions into done work. Your job is to **reduce friction**: capture the plan, keep the board workable, and recover what got lost — not just to record tasks. The unit the user cares about is their **plan** and its **tasks**; a **quest** is the workspace those live in. Quests, plans, tasks, commits, and lanes are the machinery beneath that goal — use them in that service.

## Mental model

The machinery: a **quest** (the user's workspace) owns **plans**, and each plan owns **tasks**. Plans have markdown bodies; tasks have dependencies and optional recurrence. **Versioned mutations** (anything that changes plan, task, or dependency content) group into commits with human-readable labels. **Board operations** (column shape, plan ordering, moving tasks between lanes, assignment) are non-versioned direct ops that apply immediately and are not undoable through the commit log. **Undo is strict head-only LIFO**, and it's actor-kind-guarded — by default you can only undo your own commits. History is preserved across reverts; recovery is read-and-rewrite, not graph manipulation.

Before any work, you need a current quest. Call `list_quests` if you don't have one; `set_current_quest` once the user picks. All subsequent tools default to the current quest unless overridden.

### Reading quest state

- `get_quest_view({ questId? })` — quest facts + lane config + plan headers. Pass `commitId` to preview an open commit or `asOf` (epoch ms) to project historical state. Returns an `assignees` map (`subjectId → memberIds[]`) for the whole quest.
- `list_plans({ questId?, includeUnplanned?, commitId?, asOf? })` — all live plans with full task lists and intra-plan deps.
- `get_plan({ planId, questId?, commitId?, asOf? })` — one plan's full body.
- `get_task({ taskId, questId?, commitId?, asOf? })` — one task with its deps, dependents, and recurrence siblings.
- `get_dependency_graph({ questId?, commitId?, asOf? })` — whole-quest graph with a mermaid flowchart string.
- `list_quest_members({ questId? })` — the quest roster: each member as `{ memberId, handle, name, role, joinedAt }`. `memberId` is the id the `assignees` map and assign/unassign ops use.

### Commit kinds

`begin_commit` accepts exactly four `kind` values:

| kind       | use for                                                      |
| ---------- | ------------------------------------------------------------ |
| `'edit'`   | creating or reworking content (plans, tasks, plan bodies)    |
| `'dep'`    | dependency-only changes (add/remove deps, no content change) |
| `'delete'` | removing a plan or task                                      |
| `'recur'`  | setting or changing a task's or plan's recurrence schedule   |

No other kinds are valid. The engine-internal kinds (`genesis`, `undo`, `redo`) are not accessible via tool calls.

### Schedule shape

The `schedule` object accepted by `create_task`, `update_task`, and `set_task_schedule` is:

```json
{
  "dueDate": "2026-07-01",
  "estMinutes": 30,
  "rrule": "FREQ=WEEKLY;BYDAY=MO"
}
```

Use `goalDate` instead of `dueDate` for a soft target (no board scheduling horizon commitment).

All fields are optional/nullable. Use standard RRULE strings for `rrule`.

- **`dueDate` is the hard date; `goalDate` is a soft target — set one or the other, never both** (the engine rejects both). Backlog ordering uses the effective soft date (`dueDate ?? goalDate`); only `dueDate` pulls a task onto the board's scheduling horizon. Use `goalDate` to nudge a task earlier in the backlog without committing to a hard deadline.
- **Do not set `dtstart`.** It is intentionally left unset; for a recurring task the engine stamps it on the spawned occurrence, not the origin. There is no reason to pass it over MCP.
- **No `planId` needed.** A task is in exactly one plan; the schedule tools derive it. Schedule flows through `create_task({ schedule })`, `update_task({ schedule })`, or the focused `set_task_schedule({ schedule })` — pick `set_task_schedule` (commit kind `'recur'`) when changing schedule is the primary intent.

**Plan recurrence (whole-plan repeat).** Distinct from task recurrence: a recurring _plan_ re-spawns the entire plan — its non-recurring tasks cloned, intra-plan deps copied, recurring tasks inside it excluded (they self-recur). Set it with `set_plan_schedule({ commitId, planId, schedule: { rrule } })` (commit kind `'recur'`), or inline via `create_plan({ ..., rrule })` / `update_plan({ ..., rrule })`. Use standard RRULE strings; **leave `dtstart` unset** — the engine anchors from the plan. Pass `rrule: null` to stop a plan recurring.

**Timing contrast — important.** A recurring **task** comes back _immediately_ when you complete it (the next instance appears at once, carrying its next due date). A recurring **plan** is _deferred_: the next plan instance does NOT appear until its recurrence date arrives. Don't expect a freshly-recurred plan to show up the moment the current one is finished.

### WIP limits and displacement

WIP limits are a **guardrail, not a wall**. When `move_task` targets a full lane, the engine holds the move and returns `WIP_LIMIT_EXCEEDED` with `{ laneId, limit, count, displaces }` in `_meta`, where `displaces` lists the card(s) that _would_ be bumped back to make room (each `{ taskId, title }`). Then:

1. **Name the would-be-displaced card(s) to the user** from `displaces` and ask whether to displace them, or whether to move something elsewhere.
2. On explicit confirmation, retry with `displace: true` — the engine bumps those card(s) back (a cascade) and the successful response carries `demoted: string[]` (the ids actually bumped); mention them.

Only pass `displace: true` after the user authorises it.

### Blockers and the board

Every card on the board should be independently completable, so `move_task` enforces dependency ("blocked by") edges at placement time. A blocker is unfinished until it reaches **Done** (or the dependency edge is removed). When the task you are moving has an unfinished blocker, the engine returns `BLOCKED_BY_INCOMPLETE` with `{ blockers, overridable }` in `_meta`, and the strength of the rule depends on where you are moving it:

1. **Moving to Done is never allowed while blocked** (`overridable: false`). You cannot complete a task before its blockers — finish or remove the blockers first. There is no flag that overrides this; do not try one.
2. **Moving onto the board (Todo/Doing) is allowed only with `ignoreBlockers: true`** (`overridable: true`). The default refuses, because it would put a card on the board that can't yet be worked. Pass `ignoreBlockers: true` only when the user explicitly asks to stage the blocked task anyway; otherwise tell them what it's blocked by and leave it in the backlog.

`_meta.blockers` lists the unfinished blockers (each `{ taskId, title }`) — name them to the user. `ignoreBlockers` and `displace` are independent: a move onto a full board lane may need both.

### Reflow (backlog auto-sort)

`reflow_backlog({ questId? })` re-sorts the **backlog** by effective due date (`dueDate ?? goalDate`) → cadence → FIFO, honoring recent manual moves. It is direct/un-versioned (no commit) and backlog-scoped — there is no whole-board reflow.

**Batch, then reflow once.** After creating a batch of tasks, call `reflow_backlog` a single time at the end — not once per task. Only when you created exactly one task is a single reflow (or none) appropriate. The board also reflows automatically each day at the quest's local midnight (then force-fills Todo to its WIP limit), so the morning board is already sorted; you call `reflow_backlog` explicitly only after adding tasks mid-session.

## Commit hygiene

Versioned mutations live inside an open **commit** (opened by `begin_commit`, closed by `promote_commit` or `abandon_commit`). The user sees commit labels in undo UI and history — they're load-bearing prose, not internal metadata.

- **Open one commit per coherent user intent.** "Rename plan + reorder its tasks + add one new task" → one commit labelled `replan tokyo trip`. "User asks two unrelated things in one message" → two commits.
- **Always set `label` to a human-readable summary.** Bad: `update`. Good: `add fly-out tasks for sapporo leg`.
- **Always `abandon_commit` on error or abort.** TTL exists for crashed sessions, not as the normal cleanup path. If you opened a commit and an op failed mid-flight, abandon before retrying.
- **Before `promote_commit`, re-read with the open `commitId`.** Use `get_plan({ planId, commitId })` or `get_task({ taskId, commitId })` to see exactly what's about to land. Sanity-check the diff matches the user's intent.
- **On `NEEDS_ACK`, read every commit in `subsequentCommitIds` before retrying.** The error means someone else (or the human owner) wrote new commits while yours was open. Read them with `get_commit`, then retry `promote_commit` with `ackedHeadCommitId: <current head>`. Do not blind-ack.
- **Default `undo` to `only: 'ai'`.** If the engine returns `GUARD_FAILED`, the head was authored by a human — surface its label to the user (`The most recent change was a human edit labelled "<label>"; do you want to undo it anyway?`) and only widen with `only: 'any'` after explicit confirmation.

## Scenario playbooks

The flows below are the canonical recipes. When the user's request matches a scenario, follow the recipe; deviate only when the scenario is genuinely a different shape.

### 1. Plan something new

User: "Let's plan a trip to Tokyo" / "Set up a new project plan for X" / "Add tasks for Y".

1. `begin_commit({ kind: 'edit', label: '<concrete summary>' })` — e.g. `label: 'plan tokyo trip — 7 days, 3 cities'`.
2. `create_plan({ commitId, title, bodyMd? })` — bodyMd is the markdown body, no YAML frontmatter. Use the title the user gave you; if they didn't give one, propose one and confirm. To make the whole plan repeat, pass `rrule` on `create_plan({ ..., rrule })` (or follow up later with `set_plan_schedule`); note the plan won't reappear until its next recurrence date arrives — unlike task recurrence, which spawns the next instance immediately on completion.
3. `create_task({ commitId, planId, title, bodyMd?, hue? })` — once per task. If the user listed tasks, batch them. For recurrence, add `schedule: { rrule }` (use kind `'recur'` on the commit if schedule is the primary intent).
4. `add_dependency({ commitId, blockerTaskId, blockedTaskId })` — for any task that must wait on another. Cycles and cross-quest deps are rejected by the engine; trust the error if it fires.
5. `get_plan({ planId, commitId })` — re-read the plan with the open commit overlaid. Skim the resulting bodies and task list and confirm the diff matches the user's intent.
6. `promote_commit({ commitId })` — on success, narrate the result to the user (plan title + task count). On `NEEDS_ACK`, follow the hygiene rule above.
7. After `promote_commit` succeeds, call `reflow_backlog({})` once so the new tasks sort into the backlog by date. (Tasks created inside a commit are only live in the backlog after the commit is promoted.)

If the user abandons mid-flow ("never mind, scrap that") call `abandon_commit({ commitId })` before doing anything else.

### 2. Rework an existing plan

User: "Update the Sapporo leg" / "These tasks need to be reordered" / "Push the launch date to next week".

1. `begin_commit({ kind: 'edit', label: '<concrete summary>' })` — e.g. `label: 'replan sapporo leg around train schedule'`. Use `kind: 'dep'` if only deps change; `kind: 'recur'` if only schedule changes; `kind: 'delete'` if removing.
2. `get_plan({ planId })` and `list_plans({})` — read the current state without `commitId` first, so you know what you're changing.
3. Apply changes with the right tools:
   - Plan body / title: `update_plan({ commitId, planId, title?, bodyMd? })`
   - Delete a plan: `delete_plan({ commitId, planId, questId? })` — versioned `deletePlan` op; requires the commit to be opened with `kind: 'delete'`. Deleted plans are not recoverable through `list_plans` (which shows only live plans) but are preserved in history via `plan_history`.
   - Delete a task: `remove_task({ commitId, planId, taskId, questId? })` — versioned `removeTask` op; requires `kind: 'delete'` on the commit.
   - Task fields **and schedule**: `update_task({ commitId, taskId, patch: { title?, bodyMd?, hue? }, schedule? })` — pass `schedule` to set dueDate/goalDate/estMinutes/rrule in the same commit.
   - Append a note without rewriting the body: `append_task({ taskId, md, questId? })` — immediate write, no `commitId`. On a support thread the note mirrors to the reporter's linked thread; errors `TASK_NOT_FOUND` / `THREAD_CLOSED` / `INVALID_INPUT`.
   - Reordering: `reorder_tasks({ commitId, planId, orderedTaskIds })` (full ordered list of task ids)
   - Schedule: `set_task_schedule({ commitId, taskId, schedule })` — no `planId`; the focused tool for a `recur`-kind change.
   - Plan recurrence (start/stop/adjust): `set_plan_schedule({ commitId, planId, schedule: { rrule } })` (commit kind `'recur'`), or pass `rrule` on `update_plan`. Pass `rrule: null` to stop the plan recurring.
   - Moving across plans: `move_task_to_plan({ commitId, taskId, toPlanId })`
   - Deps: `add_dependency({ commitId, blockerTaskId, blockedTaskId })` / `remove_dependency({ commitId, blockerTaskId, blockedTaskId })`
4. `get_plan({ planId, commitId })` — re-read with the commit overlaid. Confirm the diff.
5. `promote_commit({ commitId })`. Narrate.
6. If you added tasks, call `reflow_backlog({})` once after `promote_commit` — not before, since tasks inside an open commit aren't live in the backlog until promoted.

### 3. Move a task on the board

User: "Move 'book flights' to Doing" / "Put this in the backlog".

Board placement is **non-versioned** — no commit is opened.

1. `get_quest_view({})` — find the target `laneId` from the `lanes` array.
2. `move_task({ taskId, toLaneId, rank?, displace?, ignoreBlockers? })` — `rank` is a fractional-index string (optional; omit to append). On `WIP_LIMIT_EXCEEDED`, follow the WIP limit guidance above; on `BLOCKED_BY_INCOMPLETE`, follow the blockers guidance above (never force a move to Done; use `ignoreBlockers: true` for a board lane only when the user asked).
3. Narrate the new placement. If the engine spawned a recurrence sibling (`spawned` in the response), mention it.

To reorder plans on the board: `reorder_plan({ planId, rank })` — consult existing ranks from `list_plans`.

### 4. Assign tasks or plans

User: "Assign the booking tasks to Alice" / "Make Bob the owner of this plan".

Assignment is a **direct op** — no commit is opened.

1. Call `list_quest_members({})` to get the roster — each member as `{ memberId, handle, name, role, joinedAt }`. Pick the `memberId` for the person the user named. (For someone already assigned elsewhere, their id also appears in the `assignees` map from `get_quest_view`.)
2. `direct_op({ op: { op: 'assign', subjectType: 'task', subjectId: taskId, assigneeId: memberId } })` — once per subject. Use `subjectType: 'plan'` for plan-level assignment.
3. To remove: `direct_op({ op: { op: 'unassign', subjectType, subjectId, assigneeId } })`.
4. Verify with `get_quest_view({})` — current assignees appear in the `assignees` map (`subjectId → memberIds[]`).

### 5. Manage lanes (board columns)

Lane ops are **direct ops** — no commit is opened. All lane ops go through `direct_op`.

- Add a new Doing column: `direct_op({ op: { op: 'addDoingLane', name: 'In Review' } })`
- Rename: `direct_op({ op: { op: 'renameLane', laneId, name: 'New Name' } })`
- Reorder: `direct_op({ op: { op: 'moveLane', laneId, rank? } })` (omit rank to append)
- Set WIP limit: `direct_op({ op: { op: 'setWipLimit', laneId, limit: 3 } })`
- Set cadence: `direct_op({ op: { op: 'setLaneCadence', laneId, view: { trigger, freq, weekday, monthDay, hour, minute } } })` — `view` matches `cadenceViewSchema`: `trigger` is `'scheduled'|'immediate'`; `freq` is `'daily'|'weekly'|'biweekly'|'monthly'` (null for immediate); `weekday` required for weekly/biweekly; `monthDay` for monthly; `hour`/`minute` set the time-of-day. (`view` is required — there is no clear-cadence variant exposed via MCP.)
- Delete (must be empty, must not be the last Doing lane): `direct_op({ op: { op: 'deleteLane', laneId } })`

Protected lanes (Backlog, Todo, Done) cannot be renamed, moved, or deleted.

### 6. "What changed since Monday?"

User asks a read-only question about recent activity. **No commit is opened.**

1. `quest_history({ limit: 20, beforeSeq?, includeReverted?, actorKind? })` — pull recent commits. If the user named a time window, page until you have the right range (use `beforeSeq` from the smallest seq on the previous page).
2. For each interesting commit, optionally `commit_diff({ fromCommitId: <earlier>, toCommitId: <later> })` — returns the set of touched entities with before/after snapshots.
3. Narrate the result in human terms: which plans/tasks changed, who authored each commit (`actorKind`), what the labels say. Don't dump JSON.

If the user wants to see what happened _between_ two specific points, pick the commit ids and call `commit_diff` once.

### 7. "What happened to the X plan?"

User asks about a specific plan's lifetime — maybe one they remember but can't find.

1. If you don't already have the `planId`, call `quest_history({ includeReverted: true })` to discover it — scroll through commit entries and look for a plan matching the user's description. `list_plans({})` only returns **live** plans (no `includeClosed` parameter exists); deleted plans will not appear there.
2. `plan_history({ planId, includeReverted: true })` — returns `{ entries: Array<{ commit, snapshot }> }` where `snapshot` is the plan state at that commit (`null` if the commit deleted it), including reverted branches.
3. Walk the entries oldest→newest, narrating the path. Call out reverted branches explicitly ("on the 18th this was renamed to X, but that change was later undone").

The same shape applies to tasks via `task_history({ taskId, includeReverted: true })` — returns `{ entries: Array<{ commit, snapshot }> }` where `snapshot` is the task state at that commit. (`task_history` walks the single task identity only; it does not follow the recurrence chain root.)

For direct-op history (lane changes, placements, assignment events):

- `get_lane_history({ questId? })` — full lane-config event log, oldest-first.
- `get_placement_history({ taskId, questId? })` — a task's full placement (move/lane) log.
- `explain_placement({ taskId, questId? })` — explain why a task sits where it does — returns its current placement lane/rank plus the reason, cause, and resistance recorded on it.
- `get_assignment_history({ subjectId, questId? })` — a task or plan's full assign/unassign log.
- `get_quest_state_as_of({ asOf, questId? })` — fold the direct-op event logs to a past instant (`asOf` is epoch ms); returns lane config, each task's placement, and each subject's assignees at that moment.

### 8. "Bring back the thing I deleted yesterday"

Recovery is **read-and-rewrite**, not graph manipulation. There is no "revert this specific commit" button.

1. `plan_history({ planId, includeReverted: true })` or `quest_history({ includeReverted: true })` — find the commit that contained the version the user wants back. The `_meta.commitId` of the reverted commit is what you need.
2. `get_plan({ planId, commitId: <revertedCommitId> })` — read the plan as it existed at that point. Same for any tasks you need (`get_task({ taskId, commitId })`).
3. `begin_commit({ kind: 'edit', label: 'restore tokyo plan from 2026-05-20' })` — concrete date in the label.
4. Re-emit the necessary `create_plan` / `create_task` / `update_plan` / `update_task` / `add_dependency` ops to recreate the state. The engine treats this as a fresh commit; the old commit stays reverted in history.
5. `get_plan({ planId, commitId })` to verify, then `promote_commit({ commitId })`. Narrate that the plan is back as of <restore date>.

### 9. "Undo what you just did"

1. `undo({})` — no args means LIFO undo of the head, with the default `only: 'ai'` guard.
2. On success: narrate the label of what was undone, and offer `redo` if the user changes their mind.
3. On `GUARD_FAILED`: explain that the most recent change was a human edit (the engine returns `headActorKind`, `headCommitId`, and `headLabel` in `_meta`). Quote the label. Ask whether to widen with `only: 'any'`. Only retry after explicit consent.
4. On `NOTHING_TO_UNDO`: there's nothing in the undo stack — say so, don't pretend.
5. If the user wants to undo further back than head, explain that undo is strict LIFO and offer to walk `quest_history` instead. Recovery from mid-history goes through scenario 8.

`redo({})` is symmetric — same guard, same error shape (`NOTHING_TO_REDO`).

## Error crib

The MCP tools return errors as `{ isError: true, _meta: { code, ... } }`. Branch on `_meta.code`, not the message. Stable codes:

- `NO_CURRENT_QUEST` — no quest selected and none passed. Call `list_quests`; ask the user to pick. Then `set_current_quest`.
- `NOT_A_MEMBER` — the user has no role on the named quest. Explain and stop; you can't bypass this.
- `NEEDS_ACK` — your `promote_commit` raced with other writes. `_meta.headCommitId` is the current head; `_meta.subsequentCommitIds` lists what landed between your `begin_commit` and now. Read each with `get_commit({ commitId })`, then retry `promote_commit({ commitId, ackedHeadCommitId: headCommitId })`.
- `INVALID_COMMIT` — your `commitId` isn't usable. Branch on `_meta.reason`:
  - `not_found` — the id is wrong or expired. Start over with `begin_commit`.
  - `not_open` — the commit is already promoted, abandoned, or reverted (`_meta.status` says which). Start a fresh commit.
  - `wrong_actor` — the commit was opened by a different actor (`_meta.ownerActorId`, `_meta.actorKind`). You can't take it over. Start your own.
- `COMMIT_NOT_FOUND` — `get_commit` / `commit_diff` got an id that doesn't exist on this quest. Re-read history.
- `WIP_LIMIT_EXCEEDED` — `move_task` target lane is at its WIP limit. `_meta` carries `laneId`, `limit`, `count`, and `displaces` (the card(s) that would be bumped, each `{ taskId, title }`). Name them to the user; either move elsewhere or pass `displace: true` after they confirm.
- `BLOCKED_BY_INCOMPLETE` — `move_task` was refused because the task has an unfinished blocker. `_meta` carries `blockers` (each `{ taskId, title }`) and `overridable`. `overridable: false` means a move to Done — never allowed while blocked; finish or remove the blockers first, no flag overrides it. `overridable: true` means a board lane (Todo/Doing) — retry with `ignoreBlockers: true` only if the user explicitly asked to stage it anyway; otherwise name the blockers and leave it in the backlog.
- `PLAN_NOT_FOUND` / `TASK_NOT_FOUND` — the id is wrong, or the entity was removed. Re-list to confirm; the user may be referring to something already deleted (use scenario 8 to recover if so).
- `GUARD_FAILED` — `undo`/`redo` refused because the head was authored by a different actor kind. `_meta.headActorKind`, `_meta.headCommitId`, `_meta.headLabel` describe what's at the top. Surface the label to the user; ask before widening with `only: 'any'`.
- `NOTHING_TO_UNDO` / `NOTHING_TO_REDO` — empty stack. Say so.
- `QUOTA_EXCEEDED` — the user has hit their tier limit for creating plans or tasks. Surface this to the user immediately ("You've reached the plan/task limit for your current plan") and stop — do not retry, do not abandon and re-open a commit. Upgrading their subscription is the resolution path; you cannot work around it.

Never paper over an error by silently retrying. If something fails twice with the same code, stop and ask the user.
