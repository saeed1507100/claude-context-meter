import type { SessionContextBreakdown, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Breakdown, Fill, Group, Level, Slice } from '../types'

export const ELEVATED_TOKENS = 100_000
export const HIGH_TOKENS = 200_000
export const HIGH_PERCENT = 60
export const BUSY_FIVE_HOUR = 50

export const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

export const toFill = (c: SessionContextUsage): Fill | null =>
  c.tokens === undefined
    ? null
    : { tokens: c.tokens, window: c.window, percent: c.percent ?? Math.round((c.tokens / c.window) * 100) }

const top = (groups: Map<string, number>, n: number): Group[] =>
  [...groups].map(([name, tokens]) => ({ name, tokens })).sort((a, b) => b.tokens - a.tokens).slice(0, n)

export const toBreakdown = (b: SessionContextBreakdown): Breakdown => {
  const slices: Slice[] = []
  let deferred = 0
  for (const c of b.categories) {
    if (c.kind === 'deferred') deferred += c.tokens
    else if (c.tokens > 0) slices.push({ name: c.name, tokens: c.tokens, kind: c.kind })
  }
  const servers = new Map<string, number>()
  for (const t of b.mcpTools) servers.set(t.serverName, (servers.get(t.serverName) ?? 0) + t.tokens)
  const files = new Map<string, number>()
  for (const f of b.memoryFiles) files.set(f.path, f.tokens)

  return { slices, deferred, mcpServers: top(servers, 8), memoryFiles: top(files, 8) }
}

export const fiveHourOf = (limits: readonly SessionRateLimit[]) =>
  limits.find(l => l.kind === 'five_hour')?.percentUsed ?? null

export const levelOf = (fill: Fill | null, fiveHour: number | null): Level => {
  if (fill === null) return 'ok'
  const isBusy = fiveHour !== null && fiveHour >= BUSY_FIVE_HOUR
  if (fill.tokens >= HIGH_TOKENS || fill.percent >= HIGH_PERCENT) return 'high'
  if (fill.tokens >= ELEVATED_TOKENS) return isBusy ? 'high' : 'elevated'
  return 'ok'
}

export const adviceOf = (level: Level, fill: Fill, fiveHour: number | null) => {
  if (level === 'ok') return null
  const limit = fiveHour === null ? '' : ` Your 5-hour limit is at ${Math.round(fiveHour)}%.`
  return `Every turn re-reads ~${fmt(fill.tokens)} tokens, so a large context burns your session limit faster.${limit} Save facts, progress, plan and decisions, then compact.`
}

export const SAVE_PROMPT = [
  'Context is getting large. Before we continue, checkpoint this session:',
  '1. Write the key facts, current progress, the plan and next steps, and decisions made (with their reasons) to a durable place that fits this project:',
  '   its existing progress/notes file if it has one, otherwise a HANDOFF.md at the project root; save anything that should outlive the project to memory.',
  '2. Reply with a short list of what you saved and where.',
  'Do not start new work in this turn.',
].join('\n')

export const COMPACT_INSTRUCTIONS =
  'Keep: the task goal, key facts, progress, the plan and next steps, decisions and their reasons, and the paths of any notes saved this session.'

const PALETTE: Record<string, string> = {
  'System prompt': '#6b7cff',
  'System tools': '#8f6bff',
  'MCP tools': '#d06bff',
  'MCP server instructions': '#ff6bc4',
  'Custom agents': '#ff8f6b',
  'Memory files': '#ffb86b',
  Skills: '#e6d36b',
  Messages: '#4fc38a',
  'Free space': '#8884',
  'Autocompact buffer': '#c4575788',
}
const FALLBACK = ['#5fb3d9', '#9ad95f', '#d95f9a', '#d9b35f']

export const colorOf = (name: string, i: number) => PALETTE[name] ?? FALLBACK[i % FALLBACK.length]!

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const tip = (s: Slice, total: number) =>
  `${esc(s.name)}: ${fmt(s.tokens)} tokens (${((s.tokens / total) * 100).toFixed(1)}%)`

const HOVER = '<style>rect.s{transition:opacity .15s}svg:hover rect.s{opacity:.45}svg:hover rect.s:hover{opacity:1}</style>'

export const barSvg = (slices: readonly Slice[], height = 12) => {
  const total = slices.reduce((n, s) => n + s.tokens, 0) || 1
  let x = 0
  const rects = slices.map((s, i) => {
    const w = (s.tokens / total) * 1000
    const r = `<rect class="s" x="${x.toFixed(2)}" y="0" width="${Math.max(w, 0.5).toFixed(2)}" height="${height}" fill="${colorOf(s.name, i)}"><title>${tip(s, total)}</title></rect>`
    x += w
    return r
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 ${height}" width="100%" height="${height}" preserveAspectRatio="none">${HOVER}<rect x="0" y="0" width="1000" height="${height}" rx="3" fill="#8882"/>${rects.join('')}</svg>`
}

export const rowsSvg = (slices: readonly Slice[]) => {
  const total = slices.reduce((n, s) => n + s.tokens, 0) || 1
  const max = Math.max(...slices.map(s => s.tokens), 1)
  const rowH = 26
  const rows = slices.map((s, i) => {
    const y = i * rowH
    const w = (s.tokens / max) * 420
    return `<g><title>${tip(s, total)}</title><text x="0" y="${y + 17}" font-size="13" fill="currentColor">${esc(s.name)}</text><rect class="s" x="190" y="${y + 5}" width="${Math.max(w, 1).toFixed(1)}" height="16" rx="3" fill="${colorOf(s.name, i)}"/><text x="${(196 + w).toFixed(1)}" y="${y + 17}" font-size="12" fill="currentColor" opacity=".7">${fmt(s.tokens)} · ${((s.tokens / total) * 100).toFixed(1)}%</text></g>`
  })
  const h = slices.length * rowH
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 ${h}" width="100%" style="color:#999;font-family:system-ui,sans-serif">${HOVER}${rows.join('')}</svg>`
}

export const textBar = (slices: readonly Slice[], width: number) => {
  const total = slices.reduce((n, s) => n + s.tokens, 0) || 1
  return slices.map((s, i) => ({ s, i, cells: Math.round((s.tokens / total) * width) })).filter(p => p.cells > 0)
}
