import { describe, expect, test } from 'claude-code/testing'

import { adviceOf, fmt, levelOf, meterSvg, partsOf, textMeter, toBreakdown, toFill } from '../hooks/model'

const fill = (tokens: number, window = 1_000_000) => ({ tokens, window, percent: Math.round((tokens / window) * 100) })

describe('levelOf', () => {
  test('small context is ok', async () => {
    expect(levelOf(fill(81_000), 12)).toBe('ok')
  })
  test('100k+ is elevated, high once the 5-hour limit is busy', async () => {
    expect(levelOf(fill(120_000), 20)).toBe('elevated')
    expect(levelOf(fill(120_000), 55)).toBe('high')
  })
  test('200k+ or 60% of the window is high', async () => {
    expect(levelOf(fill(210_000), null)).toBe('high')
    expect(levelOf(fill(130_000, 200_000), null)).toBe('high')
  })
  test('no measurement is ok', async () => {
    expect(levelOf(null, 90)).toBe('ok')
  })
})

describe('adviceOf', () => {
  test('silent when ok, names tokens and the 5-hour limit otherwise', async () => {
    expect(adviceOf('ok', fill(10_000), null)).toBe(null)
    expect(adviceOf('high', fill(250_000), 63.4)).toBe('Each turn re-reads 250.0k · 5h limit 63%')
  })
})

test('toFill waits for a reported token count', async () => {
  expect(toFill({ window: 1000 })).toBe(null)
  expect(toFill({ tokens: 250, window: 1000 })).toEqual({ tokens: 250, window: 1000, percent: 25 })
})

test('toBreakdown keeps deferred out of the slices and groups MCP tools by server', async () => {
  const b = toBreakdown({
    categories: [
      { name: 'Messages', tokens: 20_000, color: 'x', isDeferred: false, kind: 'used' },
      { name: 'MCP tools (deferred)', tokens: 195_000, color: 'x', isDeferred: true, kind: 'deferred' },
      { name: 'Free space', tokens: 880_000, color: 'x', isDeferred: false, kind: 'free' },
    ],
    mcpTools: [
      { name: 'a', serverName: 'notion', tokens: 300, isLoaded: true },
      { name: 'b', serverName: 'notion', tokens: 200, isLoaded: true },
      { name: 'c', serverName: 'neon', tokens: 100, isLoaded: true },
    ],
    memoryFiles: [{ path: '/x/CLAUDE.md', type: 'Project', tokens: 740 }],
  } as never)
  expect(b.slices.map(s => s.name)).toEqual(['Messages', 'Free space'])
  expect(b.deferred).toBe(195_000)
  expect(b.mcpServers).toEqual([{ name: 'notion', tokens: 500 }, { name: 'neon', tokens: 100 }])
})

test('the meter groups categories, scales to the window, and tooltips each group', async () => {
  const slices = [
    { name: 'Messages', tokens: 100_000, kind: 'used' as const },
    { name: 'System prompt', tokens: 10_000, kind: 'used' as const },
    { name: 'System tools', tokens: 10_000, kind: 'used' as const },
    { name: 'A<b>', tokens: 5_000, kind: 'used' as const },
    { name: 'Free space', tokens: 842_000, kind: 'free' as const },
    { name: 'Autocompact buffer', tokens: 33_000, kind: 'buffer' as const },
  ]
  expect(partsOf(slices).map(p => [p.name, p.tokens])).toEqual([
    ['Messages', 100_000],
    ['System', 20_000],
    ['Other', 5_000],
  ])
  const svg = meterSvg(slices, 1_000_000, 200, 6)
  expect(svg).toContain('<title>Messages · 100.0k · 10.0%')
  expect(svg).toContain('A&lt;b&gt;')
  expect(svg).toContain('prefers-color-scheme:dark')
  expect(svg).toContain('Autocompact buffer')
  expect(svg).not.toContain('<script')
})

test('the terminal meter sizes parts to the window', async () => {
  const cells = textMeter([{ name: 'Messages', tokens: 500, kind: 'used' }], 1000, 20)
  expect(cells[0]!.cells).toBe(10)
  expect(fmt(1_250_000)).toBe('1.3M')
})
