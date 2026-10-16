import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level } from '../types'
import {
  COMPACT_INSTRUCTIONS,
  SAVE_PROMPT,
  adviceOf,
  fiveHourOf,
  fmt,
  levelOf,
  meterSvg,
  partsOf,
  swatch,
  textMeter,
  toBreakdown,
  toFill,
} from './model'

const PANE = 'context-meter'

const fill = atom({ plugin: 'context-meter', key: 'fill' } as const, null)
const breakdown = atom({ plugin: 'context-meter', key: 'breakdown' } as const, null)
const fiveHour = atom({ plugin: 'context-meter', key: 'fiveHour' } as const, null)
const warnedLevel = atom({ plugin: 'context-meter', key: 'warnedLevel' } as const, 'ok')
const isCompactPending = atom({ plugin: 'context-meter', key: 'isCompactPending' } as const, false)
const isDismissed = atom({ plugin: 'context-meter', key: 'isDismissed' } as const, false)

const RANK: Record<Level, number> = { ok: 0, elevated: 1, high: 2 }

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: 'Context' })

const saveState = ($: EngineInterface) => $.prompt.submit({ text: SAVE_PROMPT, asUser: true })

const saveAndCompact = async ($: EngineInterface) => {
  await update($, isCompactPending, () => true)
  await saveState($)
}

const compact = ($: EngineInterface) => $.session.compact({ instructions: COMPACT_INSTRUCTIONS })

const measure = async ($: EngineInterface) => {
  const usage = await $.session.usage({ breakdown: 'summary' })
  const f = toFill(usage.context)
  const hourly = fiveHourOf(usage.rateLimits)
  await update($, fill, () => f)
  await update($, fiveHour, () => hourly)
  if (usage.context.breakdown) {
    const b = toBreakdown(usage.context.breakdown)
    await update($, breakdown, () => b)
  }

  const level = levelOf(f, hourly)
  const warned = await read($, warnedLevel)
  if (RANK[level] > RANK[warned] && f !== null) {
    $.ui.toast(`Context at ${fmt(f.tokens)} (${f.percent}%). Consider saving state and compacting.`)
    await update($, isDismissed, () => false)
  }
  await update($, warnedLevel, () => level)
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'context-meter',
      description: 'Open the context breakdown pane',
    })
    await measure($)
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await measure($)
    return next(e)
  })

  on('command.run', { command: 'context-meter' }, async $ => {
    await openPane($)
    return { text: 'Context pane opened.' }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (await read($, isCompactPending)) {
      await update($, isCompactPending, () => false)
      void compact($)
    }
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const f = await read($, fill)
    if (e.props.hasSurvey || f === null) return next(e)

    const b = await read($, breakdown)
    const hourly = await read($, fiveHour)
    const level = levelOf(f, hourly)
    const advice = (await read($, isDismissed)) ? null : adviceOf(level, f, hourly)
    const tone = level === 'high' ? 'error' : 'warning'
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
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
          <Box flexGrow={1} />
          <Button key="details" label="Details" plain onPress={() => openPane($)} />
        </Box>
        {advice !== null && (
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text color={tone}>▲</Text>
            <Text dimColor>{advice}</Text>
            <Box flexGrow={1} />
            <Button key="save-compact" label="Save & compact" variant="primary" onPress={() => saveAndCompact($)} />
            <Button key="dismiss" label="Later" plain onPress={() => update($, isDismissed, () => true)} />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined
    const f = await read($, fill)
    const b = await read($, breakdown)
    const hourly = await read($, fiveHour)
    if (f === null || b === null) return <Text dimColor>Waiting for the first reply.</Text>

    const level = levelOf(f, hourly)
    const advice = adviceOf(level, f, hourly)
    const parts = partsOf(b.slices)
    const col = (s: string, n: number) => s.slice(0, n).padEnd(n)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} alignItems="flex-end">
          <Text bold>{fmt(f.tokens)}</Text>
          <Text dimColor>
            of {fmt(f.window)} · {f.percent}%{hourly === null ? '' : ` · 5h limit ${Math.round(hourly)}%`}
          </Text>
        </Box>
        {Svg !== undefined && (
          <Svg source={meterSvg(b.slices, f.window, 320, 10)} alt="Context window by group" width={320} height={10} isInteractive />
        )}
        <Box flexDirection="column">
          {parts.map(p => (
            <Text>
              <Text color={swatch(p.slot)}>■ </Text>
              {col(p.name, 18)}
              <Text dimColor>{fmt(p.tokens).padStart(7)}</Text>
            </Text>
          ))}
          <Text dimColor>
            {'  '}
            {col('Deferred tools', 18)}
            {fmt(b.deferred).padStart(7)} (not in window)
          </Text>
        </Box>
        {b.mcpServers.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>MCP servers</Text>
            {b.mcpServers.slice(0, 5).map(g => (
              <Text>
                {'  '}
                {col(g.name, 30)}
                <Text dimColor>{fmt(g.tokens).padStart(7)}</Text>
              </Text>
            ))}
          </Box>
        )}
        {advice !== null && (
          <Text>
            <Text color={level === 'high' ? 'error' : 'warning'}>▲ </Text>
            <Text dimColor>{advice}</Text>
          </Text>
        )}
        <Box flexDirection="row" gap={1}>
          <Button key="save-compact" label="Save & compact" variant="primary" hotkey="s" onPress={() => saveAndCompact($)} />
          <Button key="save" label="Save" hotkey="v" onPress={() => saveState($)} />
          <Button key="compact" label="Compact" hotkey="c" onPress={() => compact($)} />
          <Button key="refresh" label="Refresh" hotkey="r" plain onPress={() => measure($)} />
        </Box>
      </Box>
    )
  })
}
