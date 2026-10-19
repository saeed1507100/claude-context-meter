import type { Notes } from '../types'

export const NOTES_TOOL = 'session_notes'

/** A registered tool reaches tool.call under its wire name, `mcp__<plugin>__<name>`. */
export const isNotesTool = (tool: string) => tool === NOTES_TOOL || tool === `mcp__context-meter__${NOTES_TOOL}`

export const EMPTY_NOTES: Notes = { goal: null, plan: [], decisions: [], updatedAt: 0 }

const MAX_DECISIONS = 12

/** The store key for one project's notes; they live in the plugin's store under ~/.claude, never in the repo. */
export const notesKey = (root: string) => `notes:${root}`

export const NOTES_SCHEMA = {
  type: 'object',
  properties: {
    goal: { type: 'string', description: 'What this session is for, one line' },
    plan: { type: 'array', items: { type: 'string' }, description: 'Every step in order; replaces the plan' },
    done: { type: 'array', items: { type: 'number' }, description: '1-based plan steps now finished' },
    decision: { type: 'string', description: 'A decision and its reason, one line' },
    clear: { type: 'boolean', description: 'Drop all notes for this project' },
  },
} as const

export const NOTES_DESCRIPTION =
  "Session notes for this project: the goal, the plan with finished steps, and decisions with their reasons. They are kept outside the repo and shown to you after /compact or in a new session. Record the plan when you start multi-step work, mark steps done, and log each decision. Don't mention the tool."

export type NotesInput = { goal?: unknown; plan?: unknown; done?: unknown; decision?: unknown; clear?: unknown }

const line = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : null)

/** Notes after one tool call; an unknown or empty field leaves its part as it was. */
export const applyNotes = (n: Notes, input: NotesInput, now: number): Notes => {
  if (input.clear === true) return { ...EMPTY_NOTES, updatedAt: now }
  const goal = line(input.goal) ?? n.goal
  const steps = Array.isArray(input.plan) ? input.plan.map(line).filter((s): s is string => s !== null) : null
  const plan = steps !== null && steps.length > 0 ? steps.map(text => ({ text, done: false })) : n.plan
  const done = new Set(Array.isArray(input.done) ? input.done.filter((i): i is number => typeof i === 'number') : [])
  const decision = line(input.decision)
  return {
    goal,
    plan: plan.map((s, i) => (done.has(i + 1) ? { ...s, done: true } : s)),
    decisions: decision === null ? n.decisions : [...n.decisions, decision].slice(-MAX_DECISIONS),
    updatedAt: now,
  }
}

export const isEmpty = (n: Notes) => n.goal === null && n.plan.length === 0 && n.decisions.length === 0

/** The first unfinished step, or null when the plan is empty or done. */
export const nextStep = (n: Notes) => n.plan.find(s => !s.done)?.text ?? null

/** The notes as the model reads them in the system prompt. */
export const notesPrompt = (n: Notes) =>
  [
    '# Session notes (context-meter)',
    'Your own notes for this project, kept across /compact and new sessions. Keep them current with the session_notes tool.',
    n.goal !== null ? `Goal: ${n.goal}` : null,
    n.plan.length > 0 ? `Plan:\n${n.plan.map((s, i) => `${i + 1}. [${s.done ? 'x' : ' '}] ${s.text}`).join('\n')}` : null,
    n.decisions.length > 0 ? `Decisions:\n${n.decisions.map(d => `- ${d}`).join('\n')}` : null,
  ]
    .filter(s => s !== null)
    .join('\n')

export const CHECKPOINT_PROMPT = [
  'Checkpoint this session before I compact it.',
  'Use the session_notes tool to record the goal, the plan with finished steps marked, and any decisions not yet logged, with their reasons.',
  'Save anything that should outlive this project to memory. Reply in one or two lines, and start no new work.',
].join(' ')
