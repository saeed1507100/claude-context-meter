// Usage: node capture.mjs  (needs `npx -y playwright@1.55` resolvable; run via run.sh)
import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const here = path.dirname(fileURLToPath(import.meta.url))
const docs = path.join(here, '..')
const FPS = 12, DUR = 10
const browser = await chromium.launch()
for (const theme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 940, height: 260 }, deviceScaleFactor: 2, colorScheme: theme })
  const page = await ctx.newPage()
  const url = 'file://' + path.join(here, 'demo.html') + `?theme=${theme}`
  await page.goto(url)
  const dir = path.join(here, '.frames', theme)
  rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
  const el = page.locator('#shot')
  for (let i = 0; i < FPS * DUR; i++) {
    await page.evaluate(t => window.setT(t), i / FPS)
    await el.screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`) })
  }
  const gif = path.join(docs, `demo-${theme}.gif`)
  execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
    '-vf', 'scale=900:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none', '-loop', '0', gif])
  const p2 = await ctx.newPage()
  await p2.goto(url + '&view=pane')
  await p2.locator('#pane').screenshot({ path: path.join(docs, `pane-${theme}.png`) })
  await ctx.close()
}
await browser.close()
