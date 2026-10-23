// Usage: node capture-showcase.mjs  (run via run.sh, which provides playwright)
import { chromium } from 'playwright'
import { mkdirSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const here = path.dirname(fileURLToPath(import.meta.url))
const FPS = 12, DUR = 11
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1200, height: 600 }, deviceScaleFactor: 2, colorScheme: 'dark' })
await page.goto('file://' + path.join(here, 'showcase.html'))
const dir = path.join(here, '.frames', 'showcase')
rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true })
for (let i = 0; i < FPS * DUR; i++) {
  await page.evaluate(t => window.setT(t), i / FPS)
  await page.locator('#shot').screenshot({ path: path.join(dir, `f${String(i).padStart(4, '0')}.png`) })
}
execFileSync('/opt/homebrew/bin/ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(dir, 'f%04d.png'),
  '-vf', 'scale=1200:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none', '-loop', '0',
  path.join(here, '..', 'showcase.gif')])
await browser.close()
