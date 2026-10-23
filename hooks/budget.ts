import type { Biggest, Breakdown, Fill, Limits, Tip, Verdict } from '../types'

import { fmt, isAppServer, serverLabel } from './model'

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

/**
 * Where one weekly window stood when today's count started, and the latest reading of it.
 * `since` is when the count started: null for the day's start, else the time of the first reading.
 */
export type WindowBaseline = { day: string; weekly: number; since: number | null; last: number; lastAt: number; resetsAt: number }

const WEEK_MS = 7 * 24 * HOUR
/** The longest gap between two readings across midnight for the earlier one to stand for the day's start. */
export const CARRY_GAP_MS = 15 * 60_000

const isBaseline = (b: unknown): b is WindowBaseline =>
  typeof b === 'object' && b !== null && typeof (b as WindowBaseline).weekly === 'number' && typeof (b as WindowBaseline).lastAt === 'number'

/**
 * Today's starting point for each weekly window, so the share used today is
 * `weekly - start`. A window is matched by its reset time (within an hour, which
 * absorbs the endpoint's jitter), so two accounts never share one.
 *
 * Only a reading taken shortly before midnight can stand for the day's start.
 * Usage between an older reading and now (other devices, claude.ai, days the
 * plugin did not run) is unknown, so the count starts at the first reading
 * and `since` says when. A week that resets restarts the count the same way.
 */
export const baselinesFor = (
  stored: unknown,
  weekly: number,
  resetsAt: number | null,
  now: number,
): { baselines: Record<string, WindowBaseline>; today: number; since: number | null } => {
  const day = dayKey(now)
  const r = resetsAt ?? 0
  const all = Object.fromEntries(
    Object.entries(typeof stored === 'object' && stored !== null ? stored : {}).filter(
      (e): e is [string, WindowBaseline] => isBaseline(e[1]) && (e[1].resetsAt === 0 || e[1].resetsAt > now - WEEK_MS),
    ),
  )
  const match = Object.entries(all).find(([, b]) => (r === 0 ? b.resetsAt === 0 : b.resetsAt !== 0 && Math.abs(b.resetsAt - r) <= HOUR))
  const prev = match?.[1]
  const fresh = { weekly, since: now as number | null }
  const begin =
    prev === undefined || prev.last > weekly
      ? fresh
      : prev.day === day
        ? { weekly: Math.min(prev.weekly, weekly), since: prev.since }
        : now - prev.lastAt <= CARRY_GAP_MS
          ? { weekly: prev.last, since: null }
          : fresh
  const key = match?.[0] ?? (r === 0 ? 'unknown' : String(Math.round(r / HOUR)))
  return {
    baselines: { ...all, [key]: { day, weekly: begin.weekly, since: begin.since, last: weekly, lastAt: now, resetsAt: r } },
    today: weekly - begin.weekly,
    since: begin.since,
  }
}

const clock = (t: number) => {
  const d = new Date(t)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** `today`, or `since 09:14` when the count started after the day began. */
export const sinceText = (since: number | null) => (since === null ? 'today' : `since ${clock(since)}`)

const MCP_UNUSED_HEAVY = 10_000
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
    conversation: 'needed: this is the conversation',
    fixed: 'needed: built in',
    unknown: 'loaded every turn',
  })[b.verdict]

/** The biggest component as `name 18.2k (31%)`. */
export const biggestText = (b: Biggest) => `${label(b)} ${fmt(b.tokens)} (${Math.round(b.share * 100)}%)`
/** Where a context is large enough that re-reading it each turn is worth a warning. */
export const LARGE_CONTEXT = 250_000

/** Tips not toasted yet, by kind; a kind that has gone away may toast again when it returns. */
export const freshTips = (tips: readonly Tip[], warned: readonly string[]) => tips.filter(t => !warned.includes(t.id))

/** What is driving the spend, most pressing first; each tip states a fact and suggests nothing. */
export const tipsOf = (args: {
  fill: Fill
  breakdown: Breakdown | null
  limits: Limits | null
  lastTurn: number | null
  weeklyToday: number | null
  /** When the weekly count started, or null for the start of the day. */
  weeklySince?: number | null
  biggest?: Biggest | null
  /** Tool calls per MCP server this session, and turns so far, to judge which servers sit unused. */
  mcpCalls?: Readonly<Record<string, number>>
  turns?: number
  budget: Budget
  now: number
}): Tip[] => {
  const { fill, breakdown, limits, lastTurn, weeklyToday, weeklySince = null, biggest = null, mcpCalls = {}, turns = 0, budget, now } = args
  const tips: Tip[] = []
  const five = limits?.fiveHour ?? null
  const resets = limits?.fiveHourResetsAt ?? null

  if (five !== null && resets !== null && isPaceHigh(five, resets, now, budget)) {
    const left = hoursLeftAtPace(five, resets, now)!
    tips.push({ id: 'pace',
      tone: 'high',
      text: `At this pace, your 5-hour limit runs out around ${clock(now + left * 3_600_000)}`,
    })
  }
  if (lastTurn !== null && lastTurn >= budget.turnAlertPercent) {
    tips.push({ id: 'turn',
      tone: lastTurn >= budget.turnAlertPercent * 2 ? 'high' : 'elevated',
      text:
        fill.tokens >= LARGE_CONTEXT
          ? `The last turn used ${lastTurn.toFixed(1)}% of your 5-hour limit, mostly re-reading ${fmt(fill.tokens)} of context`
          : `The last turn used ${lastTurn.toFixed(1)}% of your 5-hour limit`,
    })
  }
  if (fill.tokens >= LARGE_CONTEXT) {
    tips.push({ id: 'context', tone: 'elevated', text: `Context is at ${fmt(fill.tokens)}, and every turn re-reads all of it` })
  }
  const isBiggestUnused = biggest?.verdict === 'unused'
  if (isBiggestUnused) {
    tips.push({ id: 'biggest', tone: 'elevated', text: `${biggestText(biggest)} is the biggest part of context, and this session hasn't used it` })
  }
  // Only servers the user can disconnect and this session hasn't called; the app's built-in ones are a fixed cost.
  const unused = turns < UNUSED_AFTER_TURNS ? [] : (breakdown?.mcpServers ?? []).filter(s => !isAppServer(s.name) && (mcpCalls[s.name] ?? 0) === 0)
  const unusedTokens = unused.reduce((n, s) => n + s.tokens, 0)
  if (unusedTokens >= MCP_UNUSED_HEAVY && !isBiggestUnused) {
    const top = unused[0]!
    tips.push({ id: 'mcp', tone: 'elevated', text: `Unused tool servers take ${fmt(unusedTokens)} of context, ${top.label ?? serverLabel(top.name)} the most at ${fmt(top.tokens)}` })
  }
  if (weeklyToday !== null && weeklyToday >= budget.dailyWeeklyPercent * 0.8) {
    tips.push({ id: 'weekly',
      tone: weeklyToday >= budget.dailyWeeklyPercent ? 'high' : 'elevated',
      text: `You've used ${weeklyToday.toFixed(0)}% of your weekly limit ${sinceText(weeklySince)}`,
    })
  }
  return tips
}
