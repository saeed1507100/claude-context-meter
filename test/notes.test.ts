import { describe, expect, test } from 'claude-code/testing'

import { EMPTY_NOTES, applyNotes, isEmpty, nextStep, notesPrompt } from '../hooks/notes'

describe('applyNotes', () => {
  const started = applyNotes(EMPTY_NOTES, { goal: 'Ship 1.3.0', plan: ['Fix band', 'Write tests', 'Release'] }, 1)

  test('a plan starts with every step open, and the first is next', async () => {
    expect(started.plan.every(s => !s.done)).toBe(true)
    expect(nextStep(started)).toBe('Fix band')
  })
  test('done marks 1-based steps, and decisions append', async () => {
    const n = applyNotes(started, { done: [1], decision: 'Status line as fallback: the band holds one tree' }, 2)
    expect(nextStep(n)).toBe('Write tests')
    expect(n.goal).toBe('Ship 1.3.0')
    expect(n.decisions).toEqual(['Status line as fallback: the band holds one tree'])
  })
  test('clear empties the notes; junk input changes nothing', async () => {
    expect(isEmpty(applyNotes(started, { clear: true }, 3))).toBe(true)
    expect(applyNotes(started, { plan: 'nope', done: ['x'], decision: '  ' }, 4).plan).toEqual(started.plan)
  })
  test('the prompt lists the plan with checkboxes', async () => {
    const text = notesPrompt(applyNotes(started, { done: [1] }, 5))
    expect(text).toContain('Goal: Ship 1.3.0')
    expect(text).toContain('1. [x] Fix band')
    expect(text).toContain('2. [ ] Write tests')
  })
})
