import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Level, Limits, Notes } from '../types'
import { LARGE_CONTEXT, baselineFor, freshTips, biggestOf, biggestText, budgetOf, parseLimits, tipsOf, verdictText } from './budget'
import type { Budget } from './budget'
import { CHECKPOINT_PROMPT, EMPTY_NOTES, NOTES_DESCRIPTION, NOTES_SCHEMA, NOTES_TOOL, applyNotes, isEmpty, isNotesTool, nextStep, notesKey, notesPrompt } from './notes'
import type { NotesInput } from './notes'
import {
  POLL_MS,
  USAGE_URL,
  fmt,
  levelOf,
  limitsOfReply,
  meterSvg,
  partsOf,
  rankOf,
  serverLabel,
  serverOfTool,
  swatch,
  textMeter,
  toBreakdown,
  toFill,
  worst,
} from './model'

const PANE = 'context-meter'
const BASELINE_KEY = 'weeklyBaseline'

let poller: Timer | null = null

const fill = atom({ plugin: 'context-meter', key: 'fill' } as const, null)
const breakdown = atom({ plugin: 'context-meter', key: 'breakdown' } as const, null)
const limits = atom({ plugin: 'context-meter', key: 'limits' } as const, null)
const limitSource = atom({ plugin: 'context-meter', key: 'limitSource' } as const, null)
const turnStartFiveHour = atom({ plugin: 'context-meter', key: 'turnStartFiveHour' } as const, null)
const lastTurn = atom({ plugin: 'context-meter', key: 'lastTurn' } as const, null)
const weeklyToday = atom({ plugin: 'context-meter', key: 'weeklyToday' } as const, null)
const warnedTips = atom({ plugin: 'context-meter', key: 'warnedTips' } as const, [])
const notes = atom({ plugin: 'context-meter', key: 'notes' } as const, null)
const openSections = atom({ plugin: 'context-meter', key: 'openSections' } as const, {})

type Section = 'notes' | 'breakdown' | 'limits' | 'tools'
const DEFAULT_OPEN: Record<Section, boolean> = { notes: true, breakdown: false, limits: true, tools: false }
const isDismissed = atom({ plugin: 'context-meter', key: 'isDismissed' } as const, false)
const mcpCalls = atom({ plugin: 'context-meter', key: 'mcpCalls' } as const, {})
const turns = atom({ plugin: 'context-meter', key: 'turns' } as const, 0)

/** Records the limits, and today's share of the weekly limit against a baseline kept across sessions. */
const setLimits = async ($: EngineInterface, l: Limits, source: 'live' | 'reply') => {
  await update($, limits, () => l)
  await update($, limitSource, () => source)
  if (l.weekly === null) return
  const base = baselineFor(await $.store.get(BASELINE_KEY), l.weekly, await $.clock.now())
  await $.store.set(BASELINE_KEY, base)
  await update($, weeklyToday, () => l.weekly! - base.weekly)
}

/** Reads the account-wide windows, so usage from other sessions shows while this one is idle. */
const pollLimits = async ($: EngineInterface) => {
  const auth = await $.session.authorize()
  if (auth === null) return null
  try {
    const r = await $.http.fetch(USAGE_URL, { auth: auth.handle, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })
    const l = r.ok ? parseLimits(r.text) : null
    if (l !== null) await setLimits($, l, 'live')
    return l
  } catch {
    // Offline or refused: keep the last figure.
    return null
  }
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Context & limits' })

const checkpoint = ($: EngineInterface) => $.prompt.submit({ text: CHECKPOINT_PROMPT, asUser: true })

/** Loads this project's notes from the plugin store into session state. */
const loadNotes = async ($: EngineInterface) => {
  const stored = (await $.store.get(notesKey(await $.session.root()))) as Notes | undefined
  await update($, notes, () => stored ?? null)
}

const saveNotes = async ($: EngineInterface, input: NotesInput) => {
  const next = applyNotes((await read($, notes)) ?? EMPTY_NOTES, input, await $.clock.now())
  await $.store.set(notesKey(await $.session.root()), next)
  await update($, notes, () => next)
  return next
}

/** Everything a drawing or a toast judges by, read in one place. */
const snapshot = async ($: EngineInterface, budget: Budget) => {
  const f = await read($, fill)
  const b = await read($, breakdown)
  const l = await read($, limits)
  const turn = await read($, lastTurn)
  const today = await read($, weeklyToday)
  const turnCount = await read($, turns)
  const biggest = f === null || b === null ? null : biggestOf({ fill: f, breakdown: b, mcpCalls: await read($, mcpCalls), turns: turnCount })
  const tips =
    f === null
      ? []
      : tipsOf({ fill: f, breakdown: b, limits: l, lastTurn: turn, weeklyToday: today, biggest, budget, now: await $.clock.now() })
  const level = tips.reduce<Level>((acc, t) => worst(acc, t.tone), levelOf(f, l?.fiveHour ?? null))
  return { f, b, l, turn, today, tips, level, biggest, turnCount }
}

/** One toast the first time each kind of tip appears; the band's tip comes back with it. */
const warn = async ($: EngineInterface, budget: Budget) => {
  const { tips } = await snapshot($, budget)
  const fresh = freshTips(tips, await read($, warnedTips))
  if (fresh.length > 0) {
    $.ui.toast(`⚠️ ${fresh[0]!.text}`)
    await update($, isDismissed, () => false)
  }
  await update($, warnedTips, () => tips.map(t => t.id))
}

const measure = async ($: EngineInterface, budget: Budget) => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  await update($, fill, () => toFill(usage.context))
  if ((await read($, limitSource)) !== 'live') {
    const l = limitsOfReply(usage.rateLimits)
    if (l !== null) await setLimits($, l, 'reply')
  }
  if (usage.context.breakdown) {
    const b = toBreakdown(usage.context.breakdown)
    await update($, breakdown, () => b)
  }
  await warn($, budget)
  const f = await read($, fill)
  // The status line stays visible when another mod holds the band above the prompt.
  if (f !== null) $.ui.status(`Context ${fmt(f.tokens)} · ${f.percent}%`)
}

const pctText = (n: number | null) => (n === null ? '–' : `${Math.round(n)}%`)

export const register: Register = (on, options) => {
  const budget = budgetOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'context-meter', description: 'Open the context and usage-limit pane' })
    await $.tool.register({ name: NOTES_TOOL, description: NOTES_DESCRIPTION, inputSchema: NOTES_SCHEMA })
    await loadNotes($)
    await measure($, budget)
    void pollLimits($)
    poller?.cancel()
    poller = $.clock.every(POLL_MS, () => void pollLimits($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($, budget)
    return next(e)
  })

  on('command.run', { command: 'context-meter' }, async $ => {
    await openPane($)
    return { text: 'Context pane opened.' }
  })

  on('tool.describe', { tool: NOTES_TOOL }, async ($, e, next) => ({ ...(await next(e)), isDeferred: false }))

  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const n = await read($, notes)
    if (n === null || isEmpty(n)) return result
    return { sections: [...result.sections, { id: 'context-meter:notes', text: notesPrompt(n), scope: 'session' as const }] }
  })

  on('tool.call', async ($, e, next) => {
    if (isNotesTool(e.tool)) {
      const step = nextStep(await saveNotes($, e as unknown as NotesInput))
      return { result: step === null ? 'Saved.' : `Saved. Next: ${step}` }
    }
    const result = await next(e)
    // Counting is a side note; it must never fail the tool call.
    try {
      const server = serverOfTool(e.tool, await read($, breakdown))
      if (server !== null) await update($, mcpCalls, c => ({ ...c, [server]: (c[server] ?? 0) + 1 }))
    } catch {}
    return result
  })

  on('turn.start', async ($, e, next) => {
    // Only a live reading at both ends gives a turn's cost; a cached one would be stale.
    const l = await pollLimits($)
    await update($, turnStartFiveHour, () => l?.fiveHour ?? null)
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    await update($, turns, n => n + 1)
    const before = await read($, turnStartFiveHour)
    const l = await pollLimits($)
    const after = l?.fiveHour ?? null
    // A drop means the window reset during the turn; the delta is then unknown.
    if (before !== null && after !== null && after >= before) {
      await update($, lastTurn, () => after - before)
      await warn($, budget)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { f, b, l, turn, tips, level } = await snapshot($, budget)
    // Another mod's band (a progress bar) stacks under the meter instead of replacing it.
    const below = await next(e)

    const tip = (await read($, isDismissed)) || level === 'ok' ? null : (tips[0] ?? null)
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    if (f === null)
      return (
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1}>
            <Text dimColor>Context · measuring after the first reply</Text>
          </Box>
          {below}
        </Box>
      )
    const figure = `${fmt(f.tokens)} / ${fmt(f.window)}`

    const meter =
      b === null ? null : Svg !== undefined ? (
        <Svg source={meterSvg(b.slices, f.window, 160, 6)} alt={`Context ${figure}, ${f.percent}%`} width={160} height={6} isInteractive />
      ) : (
        <Text>
          {textMeter(b.slices, f.window, 20).map(m => (
            <Text color={swatch(m.p.slot)}>{'━'.repeat(m.cells)}</Text>
          ))}
        </Text>
      )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text dimColor>Context</Text>
          {meter}
          <Text>{figure}</Text>
          <Text dimColor>{f.percent}%</Text>
          {l?.fiveHour != null && <Text dimColor>· 5h {pctText(l.fiveHour)}</Text>}
          {turn !== null && <Text dimColor>· last turn +{turn.toFixed(1)}%</Text>}
          <Box flexGrow={1} />
          <Button key="details" label="Details" plain onPress={() => openPane($)} />
        </Box>
        {tip !== null && (
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text>⚠️</Text>
            <Text dimColor>{tip.text}</Text>
            <Box flexGrow={1} />
            {f.tokens >= LARGE_CONTEXT && <Button key="checkpoint" label="Checkpoint" variant="primary" onPress={() => checkpoint($)} />}
            <Button key="dismiss" label="Later" plain onPress={() => update($, isDismissed, () => true)} />
          </Box>
        )}
        {below}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const { f, b, l, turn, today, tips, biggest, turnCount } = await snapshot($, budget)
    if (f === null || b === null) return <Text dimColor>Waiting for the first reply.</Text>
    const n = await read($, notes)
    const open = { ...DEFAULT_OPEN, ...(await read($, openSections)) }
    const source = await read($, limitSource)
    const parts = partsOf(b.slices)
    const hasNotes = n !== null && !isEmpty(n)
    const step = n === null ? null : nextStep(n)
    const toggle = (id: Section) => () => update($, openSections, o => ({ ...DEFAULT_OPEN, ...o, [id]: !open[id] }))

    const row = (label: string, value: string, swatchSlot?: number) => (
      <Box key={label} flexDirection="row" gap={1}>
        {swatchSlot !== undefined && <Text color={swatch(swatchSlot)}>■</Text>}
        <Text>{label}</Text>
        <Box flexGrow={1} />
        <Text bold>{value}</Text>
      </Box>
    )
    const section = (id: Section, title: string, summary: string, body: () => unknown) => (
      <Box key={id} flexDirection="column" gap={0}>
        <Box flexDirection="row" alignItems="center" gap={1}>
          <Button key={`toggle-${id}`} label={`${open[id] ? '▾' : '▸'} ${title}`} plain onPress={toggle(id)} />
          <Box flexGrow={1} />
          <Text dimColor>{summary}</Text>
        </Box>
        {open[id] && <Box flexDirection="column" paddingLeft={2}>{body() as never}</Box>}
      </Box>
    )

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Box flexDirection="row" gap={1} alignItems="flex-end">
            <Text bold>{fmt(f.tokens)}</Text>
            <Text dimColor>of {fmt(f.window)} · {f.percent}%</Text>
          </Box>
          {Svg !== undefined && <Svg source={meterSvg(b.slices, f.window, 320, 10)} alt="Context window by group" width={320} height={10} isInteractive />}
        </Box>
        {tips.length > 0 && (
          <Box flexDirection="column">
            {tips.map(t => (
              <Text>
                <Text>⚠️ </Text>
                {t.text}
              </Text>
            ))}
          </Box>
        )}
        {section('notes', 'Session notes', hasNotes ? (step === null ? 'plan done' : `next: ${step}`) : 'none yet', () =>
          !hasNotes ? (
            <Text dimColor>Claude records the plan and decisions as it works.</Text>
          ) : (
            <Box flexDirection="column">
              {n!.goal !== null && <Text bold>{n!.goal}</Text>}
              {n!.plan.map((s, i) => (
                <Text key={`step-${i}`} dimColor={s.done}>
                  {s.done ? '✓' : s.text === step ? '▸' : '○'} {s.text}
                </Text>
              ))}
              {n!.decisions.length > 0 && <Text dimColor>Decisions</Text>}
              {n!.decisions.slice(-3).map((d, i) => (
                <Text key={`dec-${i}`}>• {d}</Text>
              ))}
            </Box>
          ),
        )}
        {section('breakdown', 'What fills the context', biggest === null ? `${parts.length} groups` : `biggest: ${biggestText(biggest)}`, () => (
          <Box flexDirection="column">
            {parts.map(p => row(p.name, fmt(p.tokens), p.slot))}
            {row('Deferred tools (not loaded)', fmt(b.deferred))}
            {biggest !== null && <Text dimColor>Biggest: {biggestText(biggest)}, {verdictText(biggest, turnCount)}</Text>}
          </Box>
        ))}
        {section('limits', 'Usage limits', `5h ${pctText(l?.fiveHour ?? null)} · week ${pctText(l?.weekly ?? null)}`, () => (
          <Box flexDirection="column">
            {row('5-hour window', pctText(l?.fiveHour ?? null))}
            {row('This week', pctText(l?.weekly ?? null))}
            {row('Used today', pctText(today))}
            {turn !== null && row('Last turn', `+${turn.toFixed(1)}%`)}
            {source === 'reply' && <Text dimColor>As of the last reply.</Text>}
          </Box>
        ))}
        {b.mcpServers.length > 0 &&
          section('tools', 'Tool servers', fmt(b.mcpServers.reduce((t, g) => t + g.tokens, 0)), () => (
            <Box flexDirection="column">{b.mcpServers.slice(0, 8).map(g => row(g.label ?? serverLabel(g.name), fmt(g.tokens)))}</Box>
          ))}
        <Box flexDirection="row" gap={1}>
          <Button key="checkpoint" label="Checkpoint" variant="primary" hotkey="s" onPress={() => checkpoint($)} />
          {hasNotes && <Button key="clear" label="Clear notes" hotkey="x" plain onPress={() => saveNotes($, { clear: true })} />}
          <Button key="refresh" label="Refresh" hotkey="r" plain onPress={() => Promise.all([measure($, budget), pollLimits($)])} />
        </Box>
        <Text dimColor>Checkpoint updates the notes; then run /compact.</Text>
      </Box>
    )
  })
}
