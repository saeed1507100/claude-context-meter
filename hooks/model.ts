import type { SessionContextBreakdown, SessionContextUsage, SessionRateLimit } from 'claude-code'

import type { Breakdown, Fill, Group, Level, Limits, Slice } from '../types'

export const ELEVATED_TOKENS = 250_000
export const HIGH_TOKENS = 400_000
export const HIGH_PERCENT = 60
export const BUSY_FIVE_HOUR = 50

export const fmt = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`

export const toFill = (c: SessionContextUsage): Fill | null =>
  c.tokens === undefined
    ? null
    : { tokens: c.tokens, window: c.window, percent: c.percent ?? Math.round((c.tokens / c.window) * 100) }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Product words in connector tool names, to the product they belong to.
const PRODUCTS: [RegExp, string][] = [
  [/notion/i, 'Notion'],
  [/jira|confluence|compass|atlassian/i, 'Atlassian'],
  [/gmail/i, 'Gmail'],
  [/calendar/i, 'Google Calendar'],
  [/drive|docs|sheets/i, 'Google Drive'],
  [/slack/i, 'Slack'],
  [/linear/i, 'Linear'],
  [/github/i, 'GitHub'],
  [/asana/i, 'Asana'],
  [/figma/i, 'Figma'],
  [/hubspot/i, 'HubSpot'],
  [/intercom/i, 'Intercom'],
  [/stripe/i, 'Stripe'],
  [/sentry/i, 'Sentry'],
]

/**
 * A readable name for a server the breakdown lists only by id (a claude.ai connector),
 * from the product its tool names mention most; a short id when none matches.
 */
export const labelOfServer = (server: string, tools: readonly string[]): string | undefined => {
  if (!UUID.test(server)) return undefined
  const hits = PRODUCTS.map(([re, name]) => ({ name, n: tools.filter(t => re.test(t)).length })).sort((a, b) => b.n - a.n)
  return hits[0]!.n > 0 ? `${hits[0]!.name} (claude.ai connector)` : `claude.ai connector ${server.slice(0, 8)}`
}

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
  const mcpToolServer: Record<string, string> = {}
  const toolsOf = new Map<string, string[]>()
  for (const t of b.mcpTools) {
    mcpToolServer[t.name] = t.serverName
    toolsOf.set(t.serverName, [...(toolsOf.get(t.serverName) ?? []), t.name.split('__').pop() ?? t.name])
    // A deferred schema is outside the window until searched for, so it costs no context yet.
    if (t.isLoaded) servers.set(t.serverName, (servers.get(t.serverName) ?? 0) + t.tokens)
  }
  const files = new Map<string, number>()
  for (const f of b.memoryFiles) files.set(f.path, f.tokens)

  const mcpServers = top(servers, 8).map(g => {
    const label = labelOfServer(g.name, toolsOf.get(g.name) ?? [])
    return label === undefined ? g : { ...g, label }
  })
  return { slices, deferred, mcpServers, memoryFiles: top(files, 8), mcpToolServer }
}

/**
 * The server an MCP tool call belongs to: from the breakdown's schemas, else by the
 * wire name's `mcp__<server>__` prefix, which spells the server with `_` for other characters.
 */
export const serverOfTool = (tool: string, b: Breakdown | null): string | null => {
  if (!tool.startsWith('mcp__')) return null
  const known = b?.mcpToolServer[tool]
  if (known !== undefined) return known
  return b?.mcpServers.find(s => tool.startsWith(`mcp__${s.name.replace(/[^A-Za-z0-9_-]/g, '_')}__`))?.name ?? null
}

const windowAt = (limits: readonly SessionRateLimit[], kind: string) => limits.find(l => l.kind === kind)

/** The limit windows the last reply reported, or null when it reported none. */
export const limitsOfReply = (limits: readonly SessionRateLimit[]): Limits | null => {
  const five = windowAt(limits, 'five_hour')
  const week = windowAt(limits, 'seven_day')
  if (five === undefined && week === undefined) return null
  const at = (w?: SessionRateLimit) => (w?.resetsAt === undefined ? null : Date.parse(w.resetsAt) || null)
  return { fiveHour: five?.percentUsed ?? null, fiveHourResetsAt: at(five), weekly: week?.percentUsed ?? null, weeklyResetsAt: at(week) }
}

export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
export const POLL_MS = 60_000

export const levelOf = (fill: Fill | null, fiveHour: number | null): Level => {
  if (fill === null) return 'ok'
  const isBusy = fiveHour !== null && fiveHour >= BUSY_FIVE_HOUR
  if (fill.tokens >= HIGH_TOKENS || fill.percent >= HIGH_PERCENT) return 'high'
  if (fill.tokens >= ELEVATED_TOKENS) return isBusy ? 'high' : 'elevated'
  return 'ok'
}

const RANK: Record<Level, number> = { ok: 0, elevated: 1, high: 2 }

/** The worse of two levels. */
export const worst = (a: Level, b: Level): Level => (RANK[a] >= RANK[b] ? a : b)

export const rankOf = (l: Level) => RANK[l]

export type Part = { name: string; tokens: number; slot: number; members: string[] }

// Reference dataviz palette, adjacent order validated for CVD in both modes.
const LIGHT = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4']
const DARK = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181']

const GROUPS: [string, string[]][] = [
  ['Messages', ['Messages']],
  ['System', ['System prompt', 'System tools']],
  ['MCP', ['MCP tools', 'MCP server instructions']],
  ['Memory & skills', ['Memory files', 'Skills', 'Custom agents']],
]

export const partsOf = (slices: readonly Slice[]): Part[] => {
  const parts: Part[] = GROUPS.map(([name], slot) => ({ name, tokens: 0, slot, members: [] }))
  const other: Part = { name: 'Other', tokens: 0, slot: 4, members: [] }
  for (const s of slices) {
    if (s.kind !== 'used') continue
    const i = GROUPS.findIndex(([, names]) => names.includes(s.name))
    const part = i === -1 ? other : parts[i]!
    part.tokens += s.tokens
    part.members.push(`${s.name} ${fmt(s.tokens)}`)
  }
  return [...parts, other].filter(p => p.tokens > 0)
}

export const swatch = (slot: number) => LIGHT[slot]!

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const pct = (n: number, of: number) => `${((n / of) * 100).toFixed(1)}%`

const STYLE = `<style>
svg{--track:#e4e3df;--buf:#c9c8c2;${LIGHT.map((c, i) => `--s${i}:${c}`).join(';')}}
@media (prefers-color-scheme:dark){svg{--track:#33332f;--buf:#55544e;${DARK.map((c, i) => `--s${i}:${c}`).join(';')}}}
.m{transition:opacity .12s}svg:hover .m{opacity:.35}svg:hover .m:hover{opacity:1}
</style>`

/** A meter of the whole window: used parts in slot order, then the free track, then the compaction buffer hatched. */
export const meterSvg = (slices: readonly Slice[], window: number, width: number, height: number) => {
  const parts = partsOf(slices)
  const buffer = slices.filter(s => s.kind === 'buffer').reduce((n, s) => n + s.tokens, 0)
  const scale = width / Math.max(window, 1)
  const gap = 2
  let x = 0
  const marks = parts.map(p => {
    const w = Math.max(p.tokens * scale - gap, 2)
    const tip = `${esc(p.name)} · ${fmt(p.tokens)} · ${pct(p.tokens, window)}\n${esc(p.members.join(', '))}`
    const m = `<rect class="m" x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="${height}" fill="var(--s${p.slot})"><title>${tip}</title></rect>`
    x += w + gap
    return m
  })
  const bw = buffer * scale
  const bufMark =
    bw > 1
      ? `<rect class="m" x="${(width - bw).toFixed(1)}" y="0" width="${bw.toFixed(1)}" height="${height}" fill="url(#h)"><title>Autocompact buffer · ${fmt(buffer)} · reserved</title></rect>`
      : ''
  const r = height / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${STYLE}<defs><clipPath id="c"><rect width="${width}" height="${height}" rx="${r}"/></clipPath><pattern id="h" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill="var(--track)"/><rect width="1.5" height="4" fill="var(--buf)"/></pattern></defs><g clip-path="url(#c)"><rect width="${width}" height="${height}" fill="var(--track)"><title>Free · ${fmt(Math.max(window - parts.reduce((n, p) => n + p.tokens, 0) - buffer, 0))}</title></rect>${marks.join('')}${bufMark}</g></svg>`
}

export const textMeter = (slices: readonly Slice[], window: number, cells: number) => {
  const parts = partsOf(slices)
  return parts.map(p => ({ p, cells: Math.max(1, Math.round((p.tokens / window) * cells)) }))
}
