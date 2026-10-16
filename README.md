# context-meter

A Claude Code plugin that keeps your context window in view.

- **Meter above the prompt.** Shows tokens used out of the window, with a stacked bar split by category (system prompt, tools, MCP, memory files, skills, messages, free space, autocompact buffer). Hover a segment to see its tokens and share. The bar is graphical in the desktop app, VS Code and mobile, and drawn in block characters in the terminal.
- **Detail pane.** Click **Details**, or run `/context-meter`, to open a pane with a per-category chart, the largest MCP servers, your memory files, and deferred tool schemas.
- **Save-and-compact nudge.** Every turn re-sends the whole context, so a large context uses up your 5-hour session limit faster. Past 100k tokens (or sooner while the 5-hour limit is above 50%), the meter turns yellow or red and offers:
  - **Save & compact**: asks Claude to write down facts, progress, plan and decisions (in the project's notes file, or a `HANDOFF.md`), then compacts once that turn finishes.
  - **Save only** and **Compact now**, for doing one step yourself.
  - **Dismiss**, which hides the nudge until the context crosses the next threshold.

## Install

Run this in a Claude Code terminal session:

```
/plugin install context-meter --marketplace saeed1507100/context-meter
```

Answer `y` to add the marketplace, then pick a scope. Choose the user scope to have it in every session, desktop app included.

## Thresholds

| Level | When | Meter |
| --- | --- | --- |
| ok | under 100k tokens | dim |
| elevated | 100k tokens or more | yellow, with nudge |
| high | 200k tokens or more, 60% of the window, or 100k+ while the 5-hour limit is at 50% or more | red, with nudge |

The thresholds are set in `hooks/model.ts`.

## Develop

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

## License

MIT
