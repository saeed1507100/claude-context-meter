# Handoff: claude-context-meter

Checkpoint of the session that built this plugin (2026-10-16).

## Facts

- A Claude Code plugin. Its name is `context-meter`; the repo is `claude-context-meter`.
- Repo: https://github.com/saeed1507100/claude-context-meter, public, on the personal account. The remote is `git@github-personal:saeed1507100/claude-context-meter.git`. Use `GH_TOKEN=$(gh auth token --user saeed1507100)` for `gh` calls, because `saeed-cefalo` is the active `gh` account.
- The repo is its own marketplace: `.claude-plugin/marketplace.json`, with one entry whose source is `./`.
- To install from a terminal session: `/plugin marketplace add saeed1507100/claude-context-meter`, then `/plugin install context-meter@context-meter`.
- Files:
  - `hooks/register.tsx`: the hooks (band, pane, command, polling, save and compact).
  - `hooks/model.ts`: pure logic (levels, advice, grouping, SVG meter, parsing).
  - `types/index.d.ts`: the `$.state` contract.
  - `test/model.test.ts`: 10 tests.
- Dev loop: `claude plugin validate .`, `claude plugin test .`, and `tsc` against the engine's `claude-code.d.ts`. The tsconfig is in the plugin-authoring skill's types header.
- In the dev session, `~/.claude/dev-mods/<session>/context-meter` is a symlink to this repo, so it hot-reloads.

## What works (seen by the user in the desktop app, light and dark)

- A meter above the prompt: `Context [bar] 180.5k / 1.0M 18%` and a **Details** button.
  - The bar is scaled to the whole window and split into five groups: Messages, System, MCP, Memory & skills, Other.
  - Free space is the grey track; the autocompact buffer is hatched.
  - Hovering a segment shows a tooltip.
- A detail pane, opened by **Details** or `/context-meter`. It shows the hero figure, a bigger bar, the group list, deferred tools, the top MCP servers, and the buttons Save & compact, Save, Compact and Refresh.
- A nudge: `▲ Each turn re-reads Nk · 5h limit N%`, with **Save & compact** and **Later**.
  - It shows at 100k tokens or more.
  - It turns red at 200k tokens, at 60% of the window, or at 100k tokens or more once the 5-hour limit is at 50% or more.
  - A toast appears once each time it crosses a level.
- Save & compact submits the checkpoint prompt, then compacts after that turn. The first version never compacted: `session.compact` rejects while a turn runs, and `turn.complete` is still inside the turn. Fixed with a deferred retry; not yet confirmed live.
- The live 5-hour limit polls `https://api.anthropic.com/api/oauth/usage` every 60 s.
  - The request uses `$.session.authorize()` with `$.http.fetch({ auth })` and the header `anthropic-beta: oauth-2025-04-20`, and reads `five_hour.utilization`.
  - It falls back to the last reply's `rateLimits`, and the pane then says "(as of last reply)".
  - The user has confirmed it moves with other sessions' usage.

## Decisions and reasons

- **Band above the prompt, not the status line.** The status line may not draw in the desktop app; the band does.
- **Breakdown with `breakdown: 'summary'`.** It is estimated locally, so it is free on every measure. `full` sends token-count requests.
- **Five groups from the dataviz reference palette**, in the order blue, orange, aqua, yellow, magenta. That order passes the validator's color-blind checks in light and dark mode. Three light-mode colors are under 3:1 contrast, which hover tooltips and the pane's text list cover.
- **Dark mode through `@media (prefers-color-scheme)` inside the SVG.** The SVG is drawn in an isolated frame and can't read the app's theme.
- **Text uses theme ink; status color only on the ▲ glyph.** The user rejected the first version's yellow text as low contrast.
- **Live polling for the 5-hour limit.** The session's own rate-limit figures only update when this session gets a reply.

## Lessons

- Never name a variable `h` in a hooks module: JSX compiles to `h(...)`, so the band and pane threw and drew nothing. `tsc` catches it (TS2448); run it after every edit.
- `atom()` refs need literal `plugin` and `key` values; a const variable fails `claude plugin validate`.
- Narrow the `Svg` element with `'Svg' in ui`; the terminal's element table has none.

## Next steps (none started)

- Add a UI test that mounts `AbovePrompt` and `Pane` on the `terminal` and `desktop` surfaces. It would catch drawing crashes like the `h` bug.
- Make the thresholds `userConfig` options instead of constants in `hooks/model.ts`.
- Optionally show the 7-day window and the reset time from the usage endpoint.
- Optionally rename the plugin to `claude-context-meter` to match the repo. That means changing the manifest, the marketplace file, the atom `plugin` keys and the command.
