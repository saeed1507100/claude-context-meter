import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Level } from '../types'
import {
  COMPACT_INSTRUCTIONS,
  SAVE_PROMPT,
  adviceOf,
  barSvg,
  colorOf,
  fiveHourOf,
  fmt,
  levelOf,
  rowsSvg,
  textBar,
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
    const opened = await openPane($)
    const usage = await $.session.usage()
    const f = await read($, fill)
    return {
      text: `Context pane ${opened.isPlaced ? 'opened' : 'not placed by this surface'}. usage.context=${JSON.stringify(usage.context)} stored=${JSON.stringify(f)}`,
    }
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
    if (e.props.hasSurvey) return next(e)
    if (f === null) {
      const { Text } = $.ui.resolve(e)
      return <Text dimColor>Context: waiting for the first reply ({e.surface})</Text>
    }

    const b = await read($, breakdown)
    const hourly = await read($, fiveHour)
    const level = levelOf(f, hourly)
    const advice = (await read($, isDismissed)) ? null : adviceOf(level, f, hourly)
    const color = level === 'high' ? 'red' : level === 'elevated' ? 'yellow' : undefined
    const label = `Context ${fmt(f.tokens)} / ${fmt(f.window)} (${f.percent}%)`
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const Svg = 'Svg' in ui ? ui.Svg : undefined

    const bar =
      b === null ? null : Svg !== undefined ? (
        <Svg source={barSvg(b.slices)} alt={label} height={12} isInteractive />
      ) : (
        <Text>
          {textBar(b.slices, Math.max(10, Math.min(40, (e.props.bodyColumns ?? 60) - label.length - 14))).map(p => (
            <Text color={colorOf(p.s.name, p.i).slice(0, 7)}>{'█'.repeat(p.cells)}</Text>
          ))}
        </Text>
      )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1} alignItems="center">
          <Text color={color} dimColor={color === undefined}>{label}</Text>
          {bar !== null && <Box flexGrow={1}>{bar}</Box>}
          <Button key="details" label="Details" plain onPress={() => openPane($)} />
        </Box>
        {advice !== null && (
          <Box flexDirection="row" gap={1} flexWrap="wrap">
            <Text color={color}>{advice}</Text>
            <Button key="save-compact" label="Save & compact" variant="primary" onPress={() => saveAndCompact($)} />
            <Button key="save" label="Save only" onPress={() => saveState($)} />
            <Button key="dismiss" label="Dismiss" onPress={() => update($, isDismissed, () => true)} />
          </Box>
        )}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const ui = $.ui.resolve(e)
    const { Box, Text, Button } = ui
    const f = await read($, fill)
    const b = await read($, breakdown)
    const hourly = await read($, fiveHour)
    if (f === null || b === null) return <Text dimColor>No measurement yet: send a message first.</Text>

    const level = levelOf(f, hourly)
    const advice = adviceOf(level, f, hourly)
    const used = b.slices.filter(s => s.kind === 'used')
    const Svg = 'Svg' in ui ? ui.Svg : undefined

    return (
      <Box flexDirection="column" gap={1}>
        <Text bold>
          {fmt(f.tokens)} of {fmt(f.window)} tokens ({f.percent}%)
          {hourly === null ? '' : ` · 5-hour limit ${Math.round(hourly)}%`}
        </Text>
        {Svg !== undefined ? (
          <Box flexDirection="column" gap={1}>
            <Svg source={barSvg(b.slices, 18)} alt="Whole window by category" height={18} isInteractive />
            <Svg source={rowsSvg(used)} alt="Tokens in use by category" isInteractive />
          </Box>
        ) : (
          <Box flexDirection="column">
            {used.map((s, i) => (
              <Text>
                <Text color={colorOf(s.name, i).slice(0, 7)}>■ </Text>
                {s.name.padEnd(26)} {fmt(s.tokens).padStart(7)}
              </Text>
            ))}
          </Box>
        )}
        <Text dimColor>
          Deferred tool schemas (loaded on demand, not in the window): {fmt(b.deferred)}
        </Text>
        {b.mcpServers.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Largest MCP servers</Text>
            {b.mcpServers.map(g => (
              <Text dimColor>
                {g.name.slice(0, 40).padEnd(42)} {fmt(g.tokens).padStart(7)}
              </Text>
            ))}
          </Box>
        )}
        {b.memoryFiles.length > 0 && (
          <Box flexDirection="column">
            <Text bold>Memory files</Text>
            {b.memoryFiles.map(g => (
              <Text dimColor>
                {g.name.split('/').slice(-3).join('/').padEnd(42)} {fmt(g.tokens).padStart(7)}
              </Text>
            ))}
          </Box>
        )}
        {advice !== null && <Text color={level === 'high' ? 'red' : 'yellow'}>{advice}</Text>}
        <Box flexDirection="row" gap={1}>
          <Button key="save-compact" label="Save & compact" variant="primary" hotkey="s" onPress={() => saveAndCompact($)} />
          <Button key="save" label="Save only" hotkey="v" onPress={() => saveState($)} />
          <Button key="compact" label="Compact now" hotkey="c" onPress={() => compact($)} />
          <Button key="refresh" label="Refresh" hotkey="r" onPress={() => measure($)} />
        </Box>
      </Box>
    )
  })
}
