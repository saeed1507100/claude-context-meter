// Generates bars.js with real meterSvg output for each demo frame.
import { writeFileSync } from 'node:fs'
import { meterSvg } from '../../hooks/model.ts'

const W = 1_000_000
const slice = (name: string, tokens: number) => ({ name, tokens, kind: 'used' as const })
// total tokens -> slices (fixed overhead, growing messages)
const at = (total: number) => {
  const mcp = total > 100_000 ? 14_000 : 9_000
  const fixed = { sys: 7_500, tools: 9_000, mcp, mem: 6_000, skills: 4_500, other: 2_000 }
  const rest = total - Object.values(fixed).reduce((a, b) => a + b, 0)
  return [
    slice('Messages', Math.max(rest, 1000)), slice('System prompt', fixed.sys), slice('System tools', fixed.tools),
    slice('MCP tools', fixed.mcp), slice('Memory files', fixed.mem), slice('Skills', fixed.skills),
    slice('Other', fixed.other), { name: 'Autocompact buffer', tokens: 45_000, kind: 'buffer' as const },
  ]
}
const out: Record<string, { s: string; l: string }> = {}
for (let k = 20; k <= 200; k += 5) {
  const t = k * 1000
  out[k] = { s: meterSvg(at(t), W, 160, 6), l: meterSvg(at(t), W, 320, 10) }
}
out.final = { s: meterSvg(at(180_500), W, 160, 6), l: meterSvg(at(180_500), W, 320, 10) }
writeFileSync(new URL('./bars.js', import.meta.url), `window.BARS=${JSON.stringify(out)};\n`)
console.log('bars:', Object.keys(out).length)
