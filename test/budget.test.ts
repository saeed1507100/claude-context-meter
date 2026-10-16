import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_BUDGET, baselineFor, budgetOf, dayKey, hoursLeftAtPace, isPaceHigh, parseLimits, tipsOf } from '../hooks/budget'

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
    expect(tips.map(t => t.text)).toEqual(['Last turn used 3.0% of 5h on a small context: try Sonnet, lower effort, or a narrower ask'])
  })
  test('a large context suggests compacting, MCP bloat suggests disabling servers', async () => {
    const tips = tipsOf({
      ...base,
      fill: fill(150_000),
      lastTurn: 1,
      breakdown: { slices: [], deferred: 0, memoryFiles: [], mcpServers: [{ name: 'notion', tokens: 25_000 }] },
    })
    expect(tips.map(t => t.text)).toEqual([
      'Each turn re-reads 150.0k: save and compact, or /clear for a new task',
      'MCP tools hold 25.0k (notion 25.0k): disable servers you are not using',
    ])
  })
  test('daily weekly budget warns near and past the line', async () => {
    expect(tipsOf({ ...base, fill: fill(1000), lastTurn: null, weeklyToday: 21 })[0]!.tone).toBe('high')
    expect(tipsOf({ ...base, fill: fill(1000), lastTurn: null, weeklyToday: 5 })).toEqual([])
  })
})
