import { describe, expect, test } from 'claude-code/testing'

import { serverOfTool } from '../hooks/model'
import { DEFAULT_BUDGET, baselineFor, freshTips, biggestOf, budgetOf, dayKey, hoursLeftAtPace, isPaceHigh, parseLimits, tipsOf, verdictText } from '../hooks/budget'

const H = 3_600_000
const fill = (tokens: number) => ({ tokens, window: 1_000_000, percent: Math.round(tokens / 10_000) })

test('parseLimits reads both windows and their resets, and refuses junk', async () => {
  expect(parseLimits('{"five_hour":{"utilization":37.5,"resets_at":"2026-10-16T12:00:00Z"},"seven_day":{"utilization":20}}')).toEqual({
    fiveHour: 37.5,
    fiveHourResetsAt: Date.parse('2026-10-16T12:00:00Z'),
    weekly: 20,
    weeklyResetsAt: null,
  })
  expect(parseLimits('{}')).toBe(null)
  expect(parseLimits('<html>')).toBe(null)
})

describe('pace', () => {
  const resets = 10 * H
  test('50% used one hour in empties the window in one more hour, under the 4h target', async () => {
    const now = resets - 4 * H
    expect(hoursLeftAtPace(50, resets, now)).toBe(1)
    expect(isPaceHigh(50, resets, now, DEFAULT_BUDGET)).toBe(true)
  })
  test('20% used two hours in is on target', async () => {
    expect(isPaceHigh(20, resets, resets - 3 * H, DEFAULT_BUDGET)).toBe(false)
  })
  test('too early to judge', async () => {
    expect(hoursLeftAtPace(5, resets, resets - 5 * H + 60_000)).toBe(null)
  })
})

test('the weekly baseline holds for the day and restarts on a new day or a reset', async () => {
  const now = Date.parse('2026-10-16T10:00:00')
  expect(baselineFor({ day: dayKey(now), weekly: 30 }, 42, now)).toEqual({ day: dayKey(now), weekly: 30 })
  expect(baselineFor({ day: '2026-10-15', weekly: 30 }, 42, now)).toEqual({ day: dayKey(now), weekly: 42 })
  expect(baselineFor({ day: dayKey(now), weekly: 30 }, 3, now)).toEqual({ day: dayKey(now), weekly: 3 })
})

test('budgetOf drops values out of range', async () => {
  expect(budgetOf({ targetHours: 99, turnAlertPercent: 3 })).toEqual({ ...DEFAULT_BUDGET, turnAlertPercent: 3 })
})

describe('tipsOf', () => {
  const base = { breakdown: null, limits: null, weeklyToday: null, budget: DEFAULT_BUDGET, now: 0 }
  test('a heavy turn on a small context points at the model, not compacting', async () => {
    const tips = tipsOf({ ...base, fill: fill(30_000), lastTurn: 3 })
    expect(tips.map(t => t.text)).toEqual(['That turn cost 3.0% of your 5-hour limit. Sonnet, lower effort or a narrower ask would cost less'])
  })
  test('110k does not suggest compacting', async () => {
    expect(tipsOf({ ...base, fill: fill(110_000), lastTurn: null })).toEqual([])
  })
  test('a large context suggests compacting, MCP bloat suggests disabling servers', async () => {
    const tips = tipsOf({
      ...base,
      fill: fill(260_000),
      lastTurn: 1,
      breakdown: { slices: [], deferred: 0, memoryFiles: [], mcpServers: [{ name: 'notion', tokens: 25_000 }] },
    })
    expect(tips.map(t => t.text)).toEqual([
      'Context is at 260.0k and every turn re-reads it. Checkpoint, then run /compact, or /clear for a new task',
      "Tool schemas take 25.0k, notion the most at 25.0k. Disable the ones you don't need",
    ])
  })
  test('daily weekly budget warns near and past the line', async () => {
    expect(tipsOf({ ...base, fill: fill(1000), lastTurn: null, weeklyToday: 21 })[0]!.tone).toBe('high')
    expect(tipsOf({ ...base, fill: fill(1000), lastTurn: null, weeklyToday: 5 })).toEqual([])
  })
})

describe('biggestOf', () => {
  const bd = (servers: [string, number][], messages = 20_000) => ({
    slices: [
      { name: 'Messages', tokens: messages, kind: 'used' as const },
      { name: 'System prompt', tokens: 5_000, kind: 'used' as const },
    ],
    deferred: 0,
    mcpServers: servers.map(([name, tokens]) => ({ name, tokens })),
    memoryFiles: [],
    mcpToolServer: {},
  })

  test('an MCP server with no calls after three turns is not needed, and becomes a tip', async () => {
    const b = biggestOf({ fill: fill(60_000), breakdown: bd([['playwright', 30_000]]), mcpCalls: {}, turns: 3 })
    expect(b).toEqual({ kind: 'mcp', name: 'playwright', tokens: 30_000, share: 0.5, calls: 0, verdict: 'unused' })
    const tips = tipsOf({ fill: fill(60_000), breakdown: bd([['playwright', 30_000]]), limits: null, lastTurn: null, weeklyToday: null, biggest: b, budget: DEFAULT_BUDGET, now: 0 })
    expect(tips.map(t => t.text)).toEqual(["playwright MCP 30.0k (50%) is the biggest part of context, and this session hasn't used it. Disable it if this task won't"])
  })

  test('a server that was called is needed, and gets no tip', async () => {
    const b = biggestOf({ fill: fill(60_000), breakdown: bd([['playwright', 30_000]]), mcpCalls: { playwright: 2 }, turns: 5 })
    expect(b?.verdict).toBe('needed')
    expect(verdictText(b!, 5)).toBe('needed: 2 calls this session')
  })

  test('too early before three turns', async () => {
    expect(biggestOf({ fill: fill(60_000), breakdown: bd([['playwright', 30_000]]), mcpCalls: {}, turns: 1 })?.verdict).toBe('too-early')
  })

  test('messages as the biggest are the conversation', async () => {
    expect(biggestOf({ fill: fill(100_000), breakdown: bd([], 80_000), mcpCalls: {}, turns: 9 })?.verdict).toBe('conversation')
  })

  test('nothing under 10k or 15% of the used context', async () => {
    expect(biggestOf({ fill: fill(200_000), breakdown: bd([['a', 25_000]], 20_000), mcpCalls: {}, turns: 9 })).toBe(null)
    expect(biggestOf({ fill: fill(30_000), breakdown: bd([['a', 8_000]], 5_000), mcpCalls: {}, turns: 9 })).toBe(null)
  })
})

test('serverOfTool credits calls by schema, else by the wire-name prefix', async () => {
  const b = { slices: [], deferred: 0, mcpServers: [{ name: 'plugin:github:github', tokens: 1 }], memoryFiles: [], mcpToolServer: { mcp__x__y: 'linear' } }
  expect(serverOfTool('mcp__x__y', b)).toBe('linear')
  expect(serverOfTool('mcp__plugin_github_github__search', b)).toBe('plugin:github:github')
  expect(serverOfTool('Bash', b)).toBe(null)
})

test('a claude.ai connector is named as one, not as an MCP server', async () => {
  const breakdown = { slices: [], deferred: 0, mcpServers: [{ name: 'f64888b7-81de-469d-8abd-884cca000000', tokens: 30_000, label: 'Notion (claude.ai connector)' }], memoryFiles: [], mcpToolServer: {} }
  const b = biggestOf({ fill: fill(60_000), breakdown, mcpCalls: {}, turns: 3 })!
  expect(b.kind).toBe('connector')
  const [tip] = tipsOf({ fill: fill(60_000), breakdown, limits: null, lastTurn: null, weeklyToday: null, biggest: b, budget: DEFAULT_BUDGET, now: 0 })
  expect(tip!.text).toBe("Notion (claude.ai connector) 30.0k (50%) is the biggest part of context, and this session hasn't used it. Disable it if this task won't")
})

test('each kind of tip toasts once, and again after it goes away', async () => {
  const mcp = { id: 'mcp' as const, tone: 'elevated' as const, text: 'm' }
  const ctx = { id: 'context' as const, tone: 'elevated' as const, text: 'c' }
  expect(freshTips([mcp, ctx], ['mcp']).map(t => t.id)).toEqual(['context'])
  expect(freshTips([mcp], [])).toEqual([mcp])
})
