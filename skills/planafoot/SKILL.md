---
name: planafoot
description: Use when the user wants to plan, restructure, or recover work in their Planafoot quests. Triggers on "plan", "quest", "tasks", "planafoot", "what changed", "bring back", or natural undo requests.
---

# Planafoot

You're working with a Planafoot quest — an AI-first kanban for projects with plan documents, dependencies, and recurring tasks. Use this skill to plan, restructure, recover, and explain work via the Planafoot MCP tool surface.

## Mental model

A **quest** owns **plans**, and each plan owns **tasks**. Plans have markdown bodies; tasks have dependencies and optional recurrence. **Versioned mutations** (anything that changes plan, task, or dependency content) group into commits with human-readable labels. **Board operations** (column shape, plan ordering, moving tasks between lanes, assignment) are non-versioned direct ops that apply immediately and are not undoable through the commit log. **Undo is strict head-only LIFO**, and it's actor-kind-guarded — by default you can only undo your own commits. History is preserved across reverts; recovery is read-and-rewrite, not graph manipulation.

Before any work, you need a current quest. Call `list_quests` if you don't have one; `set_current_quest` once the user picks. All subsequent tools default to the current quest unless overridden.

### Reading quest state

- `get_quest_view({ questId? })` — quest facts + lane config + plan headers. Pass `commitId` to preview an open commit or `asOf` (epoch ms) to project historical state. Returns an `assignees` map (`subjectId → memberIds[]`) for the whole quest.
- `list_plans({ questId?, includeUnplanned?, commitId?, asOf? })` — all live plans with full task lists and intra-plan deps.
- `get_plan({ planId, questId?, commitId?, asOf? })` — one plan's full body.
- `get_task({ taskId, questId?, commitId?, asOf? })` — one task with its deps, dependents, and recurrence siblings.
- `get_dependency_graph({ questId?, commitId?, asOf? })` — whole-quest graph with a mermaid flowchart string.

### Commit kinds

`begin_commit` accepts exactly four `kind` values:

| kind       | use for                                                      |
| ---------- | ------------------------------------------------------------ |
| `'edit'`   | creating or reworking content (plans, tasks, plan bodies)    |
| `'dep'`    | dependency-only changes (add/remove deps, no content change) |
| `'delete'` | removing a plan or task                                      |
| `'recur'`  | setting or changing a task's recurrence schedule             |

No other kinds are valid. The engine-internal kinds (`genesis`, `undo`, `redo`) are not accessible via tool calls.

### Schedule shape (recurrence)

Recurrence is RRULE-based, not a days-count integer. The `schedule` object accepted by `create_task` and `set_task_schedule` is:

```json
{
  "dueDate": "2026-07-01",
  "estMinutes": 30,
  "rrule": "FREQ=WEEKLY;BYDAY=MO",
  "dtstart": 1751328000000
}
```

All fields are optional/nullable. Use standard RRULE strings. `dtstart` is epoch ms (UTC midnight of the start day). Anchor-free rules reset `dtstart` to the close-day's UTC midnight on spawn; anchored rules keep their `dtstart`.

### WIP limits and displacement

WIP limits are a hard board invariant. When `move_task` targets a lane that is at its limit, the engine returns `WIP_LIMIT_EXCEEDED` with `{ laneId, limit, count }` in `_meta`. You have two options:

1. Tell the user the lane is full and ask which task to displace or where else to move.
2. Pass `displace: true` — the engine bumps the lane's lowest-ranked card(s) back to make room (a cascade). Use `displace: true` only when the user explicitly authorises displacement.

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
2. `create_plan({ commitId, title, bodyMd? })` — bodyMd is the markdown body, no YAML frontmatter. Use the title the user gave you; if they didn't give one, propose one and confirm.
3. `create_task({ commitId, planId, title, bodyMd?, hue? })` — once per task. If the user listed tasks, batch them. For recurrence, add `schedule: { rrule, dtstart? }` (use kind `'recur'` on the commit if schedule is the primary intent).
4. `add_dependency({ commitId, blockerTaskId, blockedTaskId })` — for any task that must wait on another. Cycles and cross-quest deps are rejected by the engine; trust the error if it fires.
5. `get_plan({ planId, commitId })` — re-read the plan with the open commit overlaid. Skim the resulting bodies and task list and confirm the diff matches the user's intent.
6. `promote_commit({ commitId })` — on success, narrate the result to the user (plan title + task count). On `NEEDS_ACK`, follow the hygiene rule above.

If the user abandons mid-flow ("never mind, scrap that") call `abandon_commit({ commitId })` before doing anything else.

### 2. Rework an existing plan

User: "Update the Sapporo leg" / "These tasks need to be reordered" / "Push the launch date to next week".

1. `begin_commit({ kind: 'edit', label: '<concrete summary>' })` — e.g. `label: 'replan sapporo leg around train schedule'`. Use `kind: 'dep'` if only deps change; `kind: 'recur'` if only schedule changes; `kind: 'delete'` if removing.
2. `get_plan({ planId })` and `list_plans({})` — read the current state without `commitId` first, so you know what you're changing.
3. Apply changes with the right tools:
   - Plan body / title: `update_plan({ commitId, planId, title?, bodyMd? })`
   - Delete a plan: `delete_plan({ commitId, planId, questId? })` — versioned `deletePlan` op; requires the commit to be opened with `kind: 'delete'`. Deleted plans are not recoverable through `list_plans` (which shows only live plans) but are preserved in history via `plan_history`.
   - Delete a task: `remove_task({ commitId, planId, taskId, questId? })` — versioned `removeTask` op; requires `kind: 'delete'` on the commit.
   - Task fields: `update_task({ commitId, taskId, patch: { title?, bodyMd?, hue? } })`
   - Reordering: `reorder_tasks({ commitId, planId, orderedTaskIds })` (full ordered list of task ids)
   - Schedule: `set_task_schedule({ commitId, planId, taskId, schedule })` where `schedule` is `{ dueDate?, estMinutes?, rrule?, dtstart? }`
   - Moving across plans: `move_task_to_plan({ commitId, taskId, toPlanId })`
   - Deps: `add_dependency({ commitId, blockerTaskId, blockedTaskId })` / `remove_dependency({ commitId, blockerTaskId, blockedTaskId })`
4. `get_plan({ planId, commitId })` — re-read with the commit overlaid. Confirm the diff.
5. `promote_commit({ commitId })`. Narrate.

### 3. Move a task on the board

User: "Move 'book flights' to Doing" / "Put this in the backlog".

Board placement is **non-versioned** — no commit is opened.

1. `get_quest_view({})` — find the target `laneId` from the `lanes` array.
2. `move_task({ taskId, toLaneId, rank?, displace? })` — `rank` is a fractional-index string (optional; omit to append). On `WIP_LIMIT_EXCEEDED`, follow the WIP limit guidance above.
3. Narrate the new placement. If the engine spawned a recurrence sibling (`spawned` in the response), mention it.

To reorder plans on the board: `reorder_plan({ planId, rank })` — consult existing ranks from `list_plans`.

### 4. Assign tasks or plans

User: "Assign the booking tasks to Alice" / "Make Bob the owner of this plan".

Assignment is a **direct op** — no commit is opened.

1. Member ids for subjects that already have assignees are available in the `assignees` map returned by `get_quest_view({})` (`subjectId → memberIds[]`). You can reuse any id that already appears there (e.g. to assign someone who is already on another task or plan). **Member-id discovery for a brand-new assignee is not exposed over MCP** — if you need to assign someone not yet visible in `assignees`, ask the user to provide their member id.
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
- `WIP_LIMIT_EXCEEDED` — `move_task` target lane is at its WIP limit. `_meta` carries `laneId`, `limit`, `count`. Either pick a different lane or pass `displace: true` after confirming with the user.
- `PLAN_NOT_FOUND` / `TASK_NOT_FOUND` — the id is wrong, or the entity was removed. Re-list to confirm; the user may be referring to something already deleted (use scenario 8 to recover if so).
- `GUARD_FAILED` — `undo`/`redo` refused because the head was authored by a different actor kind. `_meta.headActorKind`, `_meta.headCommitId`, `_meta.headLabel` describe what's at the top. Surface the label to the user; ask before widening with `only: 'any'`.
- `NOTHING_TO_UNDO` / `NOTHING_TO_REDO` — empty stack. Say so.
- `QUOTA_EXCEEDED` — the user has hit their tier limit for creating plans or tasks. Surface this to the user immediately ("You've reached the plan/task limit for your current plan") and stop — do not retry, do not abandon and re-open a commit. Upgrading their subscription is the resolution path; you cannot work around it.

Never paper over an error by silently retrying. If something fails twice with the same code, stop and ask the user.
