import type { Breakdown, Fill, Limits, Tip } from '../types'

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
const LARGE_CONTEXT = 100_000

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
  budget: Budget
  now: number
}): Tip[] => {
  const { fill, breakdown, limits, lastTurn, weeklyToday, budget, now } = args
  const tips: Tip[] = []
  const five = limits?.fiveHour ?? null
  const resets = limits?.fiveHourResetsAt ?? null

  if (five !== null && resets !== null && isPaceHigh(five, resets, now, budget)) {
    const left = hoursLeftAtPace(five, resets, now)!
    tips.push({
      tone: 'high',
      text: `At this pace the 5h limit runs out at ${clock(now + left * 3_600_000)}, before ${budget.targetHours}h of work`,
    })
  }
  if (lastTurn !== null && lastTurn >= budget.turnAlertPercent) {
    tips.push({
      tone: lastTurn >= budget.turnAlertPercent * 2 ? 'high' : 'elevated',
      text:
        fill.tokens >= LARGE_CONTEXT
          ? `Last turn used ${lastTurn.toFixed(1)}% of 5h; most of it is re-reading ${fmt(fill.tokens)} of context`
          : `Last turn used ${lastTurn.toFixed(1)}% of 5h on a small context: try Sonnet, lower effort, or a narrower ask`,
    })
  }
  if (fill.tokens >= LARGE_CONTEXT) {
    tips.push({ tone: 'elevated', text: `Each turn re-reads ${fmt(fill.tokens)}: save and compact, or /clear for a new task` })
  }
  const mcp = breakdown?.mcpServers.reduce((n, s) => n + s.tokens, 0) ?? 0
  if (mcp >= MCP_HEAVY && breakdown !== null) {
    const top = breakdown.mcpServers[0]!
    tips.push({ tone: 'elevated', text: `MCP tools hold ${fmt(mcp)} (${top.name} ${fmt(top.tokens)}): disable servers you are not using` })
  }
  if (weeklyToday !== null && weeklyToday >= budget.dailyWeeklyPercent * 0.8) {
    tips.push({
      tone: weeklyToday >= budget.dailyWeeklyPercent ? 'high' : 'elevated',
      text: `Today used ${weeklyToday.toFixed(0)}% of the weekly limit (budget ${budget.dailyWeeklyPercent}%)`,
    })
  }
  return tips
}
