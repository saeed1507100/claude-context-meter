import type { Biggest, Breakdown, Fill, Limits, Tip, Verdict } from '../types'

import { fmt } from './model'

const HOUR = 3_600_000
const WINDOW_MS = 5 * HOUR

/** What the budget is judged against; each is a `userConfig` option. */
export type Budget = {
  /** Hours of work the 5-hour window should last. */
  targetHours: number
  /** Share of the 5-hour window one turn may use before it is flagged, in percent. */
  turnAlertPercent: number
  /** Share of the weekly limit one day may use, in percent. */
  dailyWeeklyPercent: number
}

export const DEFAULT_BUDGET: Budget = { targetHours: 4, turnAlertPercent: 2, dailyWeeklyPercent: 20 }

const num = (v: unknown, fallback: number, min: number, max: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : fallback

export const budgetOf = (o: Readonly<Record<string, unknown>>): Budget => ({
  targetHours: num(o.targetHours, DEFAULT_BUDGET.targetHours, 1, 5),
  turnAlertPercent: num(o.turnAlertPercent, DEFAULT_BUDGET.turnAlertPercent, 0.1, 50),
  dailyWeeklyPercent: num(o.dailyWeeklyPercent, DEFAULT_BUDGET.dailyWeeklyPercent, 1, 100),
})

const windowOf = (v: unknown) => {
  if (typeof v !== 'object' || v === null) return { percent: null, resetsAt: null }
  const w = v as { utilization?: unknown; resets_at?: unknown }
  const percent = typeof w.utilization === 'number' && Number.isFinite(w.utilization) ? w.utilization : null
  const t = typeof w.resets_at === 'string' ? Date.parse(w.resets_at) : NaN
  return { percent, resetsAt: Number.isNaN(t) ? null : t }
}

/** The usage endpoint's body as the two windows, or null when it has neither. */
export const parseLimits = (text: string): Limits | null => {
  let body: { five_hour?: unknown; seven_day?: unknown }
  try {
    body = JSON.parse(text) as typeof body
  } catch {
    return null
  }
  const five = windowOf(body.five_hour)
  const week = windowOf(body.seven_day)
  if (five.percent === null && week.percent === null) return null
  return { fiveHour: five.percent, fiveHourResetsAt: five.resetsAt, weekly: week.percent, weeklyResetsAt: week.resetsAt }
}

/**
 * Hours from now until the 5-hour window is used up at the pace so far in it,
 * or null when there is too little to judge (under 20 minutes in, under 5% used, or a window already reset).
 */
export const hoursLeftAtPace = (percent: number, resetsAt: number, now: number) => {
  const elapsed = now - (resetsAt - WINDOW_MS)
  if (now >= resetsAt || elapsed < 20 * 60_000 || percent < 5) return null
  const perMs = percent / elapsed
  return Math.max(100 - percent, 0) / perMs / HOUR
}

/** Whether the pace so far would empty the window before the target hours of work are done. */
export const isPaceHigh = (percent: number, resetsAt: number, now: number, b: Budget) => {
  const left = hoursLeftAtPace(percent, resetsAt, now)
  if (left === null) return false
  const elapsedH = (now - (resetsAt - WINDOW_MS)) / HOUR
  return elapsedH + left < b.targetHours && now + left * HOUR < resetsAt
}

/** The local calendar day, as the key the weekly baseline is stored under. */
export const dayKey = (now: number) => {
  const d = new Date(now)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export type DayBaseline = { day: string; weekly: number }

/** Today's baseline: kept while it is today's and the week has not reset below it, else started from now. */
export const baselineFor = (stored: unknown, weekly: number, now: number): DayBaseline => {
  const day = dayKey(now)
  const s = stored as Partial<DayBaseline> | undefined
  if (s?.day === day && typeof s.weekly === 'number' && s.weekly <= weekly) return { day, weekly: s.weekly }
  return { day, weekly }
}

const clock = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const MCP_HEAVY = 20_000
const BIGGEST_MIN_TOKENS = 10_000
const BIGGEST_MIN_SHARE = 0.15
/** Turns an MCP server may sit unused before it is judged not needed. */
export const UNUSED_AFTER_TURNS = 3

const SYSTEM = ['System prompt', 'System tools']

/**
 * The single largest component of the used context, and whether this session needs it:
 * an MCP server by its tool calls so far, the messages always (they are the conversation),
 * the system prompt and tools never removable, memory files and skills not judgeable from calls.
 * Null when nothing passes 10k tokens and 15% of the used context.
 */
export const biggestOf = (args: {
  fill: Fill
  breakdown: Breakdown
  mcpCalls: Readonly<Record<string, number>>
  turns: number
}): Biggest | null => {
  const { fill, breakdown, mcpCalls, turns } = args
  const slice = (name: string) => breakdown.slices.find(s => s.kind === 'used' && s.name === name)?.tokens ?? 0
  const candidates: Omit<Biggest, 'share'>[] = [
    ...breakdown.mcpServers.map(s => {
      const calls = mcpCalls[s.name] ?? 0
      const verdict: Verdict = calls > 0 ? 'needed' : turns < UNUSED_AFTER_TURNS ? 'too-early' : 'unused'
      return { kind: s.label === undefined ? ('mcp' as const) : ('connector' as const), name: s.label ?? s.name, tokens: s.tokens, calls, verdict }
    }),
    ...breakdown.memoryFiles.map(f => ({ kind: 'memory' as const, name: f.name, tokens: f.tokens, calls: 0, verdict: 'unknown' as const })),
    { kind: 'messages', name: 'Messages', tokens: slice('Messages'), calls: 0, verdict: 'conversation' },
    { kind: 'skills', name: 'Skills', tokens: slice('Skills'), calls: 0, verdict: 'unknown' },
    ...SYSTEM.map(n => ({ kind: 'system' as const, name: n, tokens: slice(n), calls: 0, verdict: 'fixed' as const })),
  ]
  const top = candidates.reduce((a, b) => (b.tokens > a.tokens ? b : a))
  const share = top.tokens / Math.max(fill.tokens, 1)
  if (top.tokens < BIGGEST_MIN_TOKENS || share < BIGGEST_MIN_SHARE) return null
  return { ...top, share }
}

const label = (b: Biggest) => (b.kind === 'mcp' ? `${b.name} MCP` : b.kind === 'memory' ? (b.name.split('/').pop() ?? b.name) : b.name)

/** The verdict as one short phrase, for the pane. */
export const verdictText = (b: Biggest, turns: number) =>
  ({
    needed: `needed: ${b.calls} call${b.calls === 1 ? '' : 's'} this session`,
    unused: `not needed so far: no calls in ${turns} turns`,
    'too-early': `too early to judge: ${turns} of ${UNUSED_AFTER_TURNS} turns`,
    conversation: 'needed: this is the conversation; compact to shrink it',
    fixed: 'needed: built in',
    unknown: 'loaded every turn; check it fits this task',
  })[b.verdict]

/** The biggest component as `name 18.2k (31%)`. */
export const biggestText = (b: Biggest) => `${label(b)} ${fmt(b.tokens)} (${Math.round(b.share * 100)}%)`
/** Where compacting starts to pay for itself; below it a summary loses more than it saves. */
export const LARGE_CONTEXT = 250_000

/**
 * What to do about the spend, most useful first. Compacting is one answer of
 * several: a heavy turn on a small context is the model or the task, not the context.
 */
export const tipsOf = (args: {
  fill: Fill
  breakdown: Breakdown | null
  limits: Limits | null
  lastTurn: number | null
  weeklyToday: number | null
  biggest?: Biggest | null
  budget: Budget
  now: number
}): Tip[] => {
  const { fill, breakdown, limits, lastTurn, weeklyToday, biggest = null, budget, now } = args
  const tips: Tip[] = []
  const five = limits?.fiveHour ?? null
  const resets = limits?.fiveHourResetsAt ?? null

  if (five !== null && resets !== null && isPaceHigh(five, resets, now, budget)) {
    const left = hoursLeftAtPace(five, resets, now)!
    tips.push({
      tone: 'high',
      text: `At this pace your 5-hour limit runs out around ${clock(now + left * 3_600_000)}. Lighter asks or Sonnet will stretch it`,
    })
  }
  if (lastTurn !== null && lastTurn >= budget.turnAlertPercent) {
    tips.push({
      tone: lastTurn >= budget.turnAlertPercent * 2 ? 'high' : 'elevated',
      text:
        fill.tokens >= LARGE_CONTEXT
          ? `That turn cost ${lastTurn.toFixed(1)}% of your 5-hour limit, mostly from re-reading ${fmt(fill.tokens)} of context`
          : `That turn cost ${lastTurn.toFixed(1)}% of your 5-hour limit. Sonnet, lower effort or a narrower ask would cost less`,
    })
  }
  if (fill.tokens >= LARGE_CONTEXT) {
    tips.push({ tone: 'elevated', text: `Context is at ${fmt(fill.tokens)} and every turn re-reads it. Checkpoint, then run /compact, or /clear for a new task` })
  }
  const isBiggestUnused = biggest?.verdict === 'unused'
  if (isBiggestUnused) {
    tips.push({ tone: 'elevated', text: `${biggestText(biggest)} is the biggest part of context, and this session hasn't used it. Disable it if this task won't` })
  }
  const mcp = breakdown?.mcpServers.reduce((n, s) => n + s.tokens, 0) ?? 0
  if (mcp >= MCP_HEAVY && breakdown !== null && !isBiggestUnused) {
    const top = breakdown.mcpServers[0]!
    tips.push({ tone: 'elevated', text: `Tool schemas take ${fmt(mcp)}, ${top.label ?? top.name} the most at ${fmt(top.tokens)}. Disable the ones you don't need` })
  }
  if (weeklyToday !== null && weeklyToday >= budget.dailyWeeklyPercent * 0.8) {
    tips.push({
      tone: weeklyToday >= budget.dailyWeeklyPercent ? 'high' : 'elevated',
      text: `You've used ${weeklyToday.toFixed(0)}% of your weekly limit today. A lighter pace keeps the rest of the week open`,
    })
  }
  return tips
}
