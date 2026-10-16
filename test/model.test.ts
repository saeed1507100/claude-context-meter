import { describe, expect, test } from 'claude-code/testing'

import { adviceOf, barSvg, fmt, levelOf, textBar, toBreakdown, toFill } from '../hooks/model'

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
    const text = adviceOf('high', fill(250_000), 63.4)
    expect(text).toContain('250.0k')
    expect(text).toContain('63%')
    expect(text).toContain('compact')
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

test('the bar carries a hover tooltip per category and escapes names', async () => {
  const svg = barSvg([
    { name: 'Messages', tokens: 1000, kind: 'used' },
    { name: 'A<b>', tokens: 3000, kind: 'used' },
  ])
  expect(svg).toContain('<title>Messages: 1.0k tokens (25.0%)</title>')
  expect(svg).toContain('A&lt;b&gt;')
  expect(svg).not.toContain('<script')
})

test('the terminal bar fills its width', async () => {
  const cells = textBar([{ name: 'a', tokens: 1, kind: 'used' }, { name: 'b', tokens: 3, kind: 'free' }], 20)
  expect(cells.reduce((n, p) => n + p.cells, 0)).toBe(20)
  expect(fmt(1_250_000)).toBe('1.3M')
})
