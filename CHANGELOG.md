# Changelog

## 0.7.2

- The tool-schema tip now counts only servers this session hasn't called after 3 turns, and leaves out the desktop app's built-in servers (Browser, Task list and the like), which you can't disconnect. Before, it warned about any tool schemas over 20k, including ones you need. The Details pane still lists every server's size.

## 0.7.1

- Fix "Used today" overcounting: a new day started from the last reading of any earlier day, so usage from days the plugin didn't see (for example 52% of a 57% week) showed as today's. The day's count now carries over only from a reading taken less than 15 minutes before midnight. Otherwise it starts at the first reading and shows as `Used since 09:14`.
- Match a weekly window by its reset time within an hour, so the endpoint's shifting reset timestamp no longer drops the day's starting point.
- Delete the old single `weeklyBaseline` store key.
- README: fix the install and update commands, and describe what the store keeps.

## 0.7.0

- Remove session notes, the `session_notes` tool and the Checkpoint button; notes saved by earlier versions are deleted on start.
- Make every tip a plain statement, with no suggested action.

## 0.6.6

- Fix "Used today": keep the day's starting point per weekly window, so a session on another account can't reset it, and start a new day from the last reading.

## 0.6.5

- Show each tool server's calls this session, or "unused", in the Tool servers section.
- Measure once more 2 s after `/compact` when the first look finds no figure.

## 0.6.4

- Draw the terminal bar's free space, so a small context still shows a full-width bar.
- Label the Tool servers summary with tokens and server count.

## 0.6.3

- Reload session notes at each turn and every minute, so changes from another session in the project show up.

## 0.6.2

- Update the meter right after `/compact`, estimating the size from the breakdown until the next reply.

## 0.6.1

- Toast the first time each kind of tip appears, so passing 250k always notifies.
- Mark tips with ⚠️ instead of ▲.

## 0.6.0

- Restructure the pane: tips first, then sections you can expand and collapse (notes, context, limits, tool servers).
- Line up labels and values in any font, and hide empty rows.
- Name the desktop app's built-in servers by what they do, such as "Task list (Claude app)".

## 0.5.1

- Fix `session_notes` calls failing: the hook now matches the tool's wire name.

## 0.5.0

- Suggest compacting only past 250k tokens; 110k no longer raises a toast.
- Replace the Save & compact and Compact buttons with **Checkpoint**; you run `/compact` yourself.
- Add session notes: a `session_notes` tool for goal, plan and decisions, kept outside the repo and restored after `/compact`.
- Show the meter before the first reply, stack it above other mods' bands, and mirror it in the status line.
- Reword tips in Claude's voice, without stating budget targets.

## 0.4.0 — 2026-10-16

- claude.ai connectors, listed by id, are named after their product (`Notion (claude.ai connector)`) and kept apart from MCP servers in the pane and tips.

## 0.3.0 — 2026-10-16

- Biggest component: the pane names the largest single item in the context (an MCP server, memory file, skills, messages or system) and judges whether the session needs it. An MCP server with no tool calls after 3 turns raises a tip to disable it.
- Fix: the MCP server list counted deferred schemas that are not in the window.

## 0.2.0 — 2026-10-16

- Usage budget: per-turn cost of the 5-hour window, pace projection against a target of working hours, and today's share of the weekly limit.
- Tips that name the cause: large context, a heavy turn on a small context, MCP tool bloat, pace, or the daily weekly budget. Compacting is suggested only when the context is large.
- Settings in `/config`: `targetHours`, `turnAlertPercent`, `dailyWeeklyPercent`.
- The pane shows the 5-hour, weekly and today figures.
- Fixes: the poll timer no longer doubles after a reload; a turn's cost is measured only from live readings; Compact cannot run twice at once; no pace alert from a reset window or a tiny sample.

## 0.1.0

- Context meter above the prompt, detail pane, save-and-compact nudge, live 5-hour limit.
