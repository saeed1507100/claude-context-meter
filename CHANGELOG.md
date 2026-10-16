# Changelog

## Unreleased

- Biggest component: the pane names the largest single item in the context (an MCP server, memory file, skills, messages or system) and judges whether the session needs it. An MCP server with no tool calls after 3 turns raises a tip to disable it.

## 1.0.0 — 2026-10-16

- Usage budget: per-turn cost of the 5-hour window, pace projection against a target of working hours, and today's share of the weekly limit.
- Tips that name the cause: large context, a heavy turn on a small context, MCP tool bloat, pace, or the daily weekly budget. Compacting is suggested only when the context is large.
- Settings in `/config`: `targetHours`, `turnAlertPercent`, `dailyWeeklyPercent`.
- The pane shows the 5-hour, weekly and today figures.
- Fixes: the poll timer no longer doubles after a reload; a turn's cost is measured only from live readings; Compact cannot run twice at once; no pace alert from a reset window or a tiny sample.

## 0.1.0

- Context meter above the prompt, detail pane, save-and-compact nudge, live 5-hour limit.
