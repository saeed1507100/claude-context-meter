# Claude Context Meter

**See your context window and your usage limits while you work, and get a specific warning before a session burns through them.**

A [Claude Code](https://code.claude.com) plugin for the desktop app, the terminal, VS Code and mobile.

<img alt="The meter above the prompt and the Details pane updating while Claude works through a task" src="docs/showcase.gif">

## Why

Every turn re-sends the whole conversation. At 150k tokens of context, a one-line question costs as much as a long task did at the start of the session. The desktop app no longer shows a context meter, so the first sign of trouble is often hitting the 5-hour limit.

This plugin shows what each turn costs and what is driving it. It informs; it doesn't tell you what to do:

| You see | It means |
| --- | --- |
| `Context is at 260k, and every turn re-reads all of it` | The context is past 250k tokens |
| `The last turn used 3.0% of your 5-hour limit` | One turn went over your per-turn threshold |
| `Unused tool servers take 15k of context, Notion the most at 9k` | Servers you can disconnect, uncalled after 3 turns, are taking up the window. The app's built-in servers (Browser, Task list) are left out. |
| `At this pace, your 5-hour limit runs out around 14:20` | The current pace empties the window before your target hours |
| `You've used 21% of your weekly limit today` | Today's use is near or past your daily share of the week |

## Features

- **Meter above the prompt.** Shows tokens used out of the window in a stacked bar: Messages, System, MCP, Memory & skills, Other, free space, and the hatched autocompact buffer. Hover a segment for its exact figure. The same line shows the 5-hour usage and what the last turn cost.
- **Per-turn cost.** The plugin reads the account's 5-hour utilization when a turn starts and when it ends, and shows the difference. It flags turns above your threshold (default 2%).
- **Pace projection.** Projects when the 5-hour window runs out at the current pace and warns if that is sooner than your target (default 4 hours).
- **Daily weekly budget.** Tracks how much of the 7-day limit you have used today, against a daily share (default 20%). The count is exact only when the plugin was reading your usage at midnight. Otherwise it starts at the first reading of the day and says so: `Used since 09:14`. Usage before that reading (other devices, claude.ai, sessions without the plugin) isn't counted as today.
- **Detail pane.** Click **Details** or run `/context-meter` to see the full breakdown, the largest MCP servers, deferred tools, the limit figures and every current tip.
- **Status line.** The meter also posts `Context 120k · 12%` to the status line, so it stays visible when another mod holds the band above the prompt.
- **Light and dark mode** in every surface. The palette is checked for color-blind safety.

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/pane-dark.png">
  <img alt="Detail pane with breakdown, usage limits and tips" src="docs/pane-light.png" width="520">
</picture>

## Install

In a Claude Code terminal session, run:

```
/plugin marketplace add saeed1507100/claude-context-meter
/plugin install context-meter@context-meter
```

Choose the **user** scope so the plugin runs in every session, including the desktop app. Restart open sessions, or run `/reload-plugins`.

To update later, run this in a shell (`claude plugin marketplace update` alone doesn't update the installed copy):

```
claude plugin update context-meter@context-meter
```

To remove it, run `/plugin uninstall context-meter@context-meter`.

## Settings

Change them in `/config` under **context-meter**:

| Option | Default | What it does |
| --- | --- | --- |
| `targetHours` | 4 | Warn when the pace would use up the 5-hour window sooner than this |
| `turnAlertPercent` | 2 | Flag a turn that uses more than this share of the 5-hour window |
| `dailyWeeklyPercent` | 20 | Warn when today has used more than this share of the weekly limit |

These defaults are meant for about 4 hours of work in every 5-hour window, and five working days a week.

## Privacy and security

- **No telemetry. Your data stays on your machine.** The plugin makes one network request: it reads your own usage from `api.anthropic.com/api/oauth/usage`. It does this once a minute and at the start and end of each turn.
- **The plugin never sees your token.** The request goes through Claude Code's credential handle (`$.session.authorize()`).
- With an API key, a third-party provider or no network, the request fails. The plugin then uses the figures from the session's last reply and labels them "as of last reply".
- The plugin keeps one small record per weekly window across sessions, in its own plugin store: the day's starting weekly percentage, the latest reading, and their times and reset time. It holds no prompts, tokens or session content.
- The usage endpoint is not a documented public API, so it may change. If it does, the meter falls back to the figures from the last reply.

## Limits

- The 5-hour and weekly figures are account-wide. A turn that runs while another session is active also counts that session's usage.
- The usage endpoint reports whole-window percentages, so a very small turn can show as +0.0%.
- "Used today" uses your computer's local midnight, not the weekly reset time. When the weekly window resets during the day, the count starts again from the reset.
- The context breakdown is estimated locally (`breakdown: 'summary'`), so it sends no extra token-count requests. It can differ slightly from `/context`.

## Develop

```bash
claude plugin validate .
claude plugin test .
npx -y -p typescript@5.6.3 tsc -p . --noEmit
claude --plugin-dir .
```

Regenerate the demo GIFs and pane screenshots in `docs/` with `docs/demo/run.sh` (needs ffmpeg and Playwright chromium).

## License

[MIT](LICENSE)
