import assert from 'node:assert/strict'
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes, createHash } from 'node:crypto'
import { deflateRawSync } from 'node:zlib'
import { build } from 'vite'
import { chromium, expect } from '@playwright/test'
import Cap from '@cap.js/server'
import { sandboxPolicy } from './cap-runtime.mjs'

const root = resolve(import.meta.dirname, '..')
const output = mkdtempSync(resolve(tmpdir(), 'fe-web-cap-test-'))
const parentPolicy = readFileSync(resolve(root, 'deploy/security-fe-web.conf'), 'utf8').match(/Content-Security-Policy "([^"]+)"/)[1]
assert(!parentPolicy.includes("'unsafe-eval'"))
assert(!parentPolicy.includes("'unsafe-inline'"))
assert.equal(readFileSync(resolve(root, 'deploy/security-cap-sandbox.conf'), 'utf8').match(/Content-Security-Policy "([^"]+)"/)[1], sandboxPolicy)
for (const [name, hash] of [
  ['cap_wasm-0.0.7.wasm', 'e4f3c00246a775193661f9277ca1288cd310a6514de166ecc2176ccd26fb06a9'],
  ['pako_inflate-2.1.0.min.js', 'fa226c8e1e3556993260e6a5c1fe94e225da59b3418a06811fdc51d308f8bb43'],
]) assert.equal(createHash('sha256').update(readFileSync(resolve(root, 'cap-runtime/vendor', name))).digest('hex'), hash)

await build({ root, configFile: resolve(root, 'vite.config.ts'), logLevel: 'warn', build: { outDir: output, emptyOutDir: true, rollupOptions: { input: resolve(root, 'scripts/fixtures/cap.html') } } })
const html = readFileSync(resolve(output, 'scripts/fixtures/cap.html'), 'utf8')
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml' }
const browser = await chromium.launch({ headless: true })
try {
  for (const variant of [
    { name: 'desktop-light', width: 1280, height: 900, theme: 'light' },
    { name: 'mobile-dark', width: 393, height: 852, theme: 'dark' },
    { name: 'mobile-pako-fallback', width: 393, height: 852, theme: 'dark', fallback: true },
    { name: 'missing-nonce', width: 393, height: 852, theme: 'dark', nonce: 'missing' },
    { name: 'wrong-nonce', width: 393, height: 852, theme: 'dark', nonce: 'wrong' },
  ]) {
    const context = await browser.newContext({ viewport: { width: variant.width, height: variant.height }, colorScheme: variant.theme, reducedMotion: 'reduce' })
    const cap = new Cap({ noFSState: true })
    let challenges = 0
    const requests = []
    await context.addInitScript((variant) => {
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.dataset.theme = variant.theme })
      window.__violations = []
      document.addEventListener('securitypolicyviolation', (event) => window.__violations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI }))
      if (variant.fallback) window.DecompressionStream = undefined
    }, variant)
    await context.route('**/*', async (route) => {
      const request = route.request()
      const url = new URL(request.url())
      requests.push(url.origin + url.pathname)
      if (url.hostname === 'auth.lastudio.cc') {
        const headers = { 'Access-Control-Allow-Origin': 'https://fe-web.lastudio.cc', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' })
        if (url.pathname.endsWith('/challenge')) {
          challenges++
          const data = await cap.createChallenge({ challengeCount: 4, challengeSize: 16, challengeDifficulty: 2 })
          const script = `window.onload=()=>{let parentBlocked=false,cookieBlocked=false;try{parent.document.body}catch{parentBlocked=true}try{document.cookie}catch{cookieBlocked=true}const local=40;const ok=eval('local+2')===42&&new Function('return 42')()===42;parent.postMessage({type:'cap:instr',result:{ok,parentBlocked,cookieBlocked}},'*')}`
          return route.fulfill({ headers, contentType: 'application/json', body: JSON.stringify({ ...data, instrumentation: deflateRawSync(script).toString('base64') }) })
        }
        if (url.pathname.endsWith('/redeem')) {
          const data = request.postDataJSON()
          assert.deepEqual(data.instr, { ok: true, parentBlocked: true, cookieBlocked: true })
          const result = await cap.redeemChallenge(data)
          return route.fulfill({ status: result.success ? 200 : 400, headers, contentType: 'application/json', body: JSON.stringify(result) })
        }
        return route.abort()
      }
      if (url.hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' })
      if (url.hostname !== 'fe-web.lastudio.cc') return route.abort()
      const nonce = randomBytes(16).toString('hex')
      if (url.pathname === '/') {
        let body = html.replaceAll('__LASTUDIO_CAP_NONCE__', variant.nonce === 'wrong' ? 'wrong-nonce' : nonce)
        if (variant.nonce === 'missing') body = body.replace(/<meta name="lastudio-cap-nonce"[^>]+>/, '')
        return route.fulfill({ contentType: 'text/html', headers: { 'Content-Security-Policy': parentPolicy.replaceAll('$request_id', nonce) }, body })
      }
      const file = resolve(output, '.' + decodeURIComponent(url.pathname))
      if (!file.startsWith(output + '/') || !existsSync(file)) return route.abort()
      const isSandbox = url.pathname === '/cap-assets/instrumentation-v1.html'
      return route.fulfill({ contentType: mime[extname(file)] || 'application/octet-stream', headers: isSandbox ? { 'Content-Security-Policy': sandboxPolicy.replaceAll('$request_id', nonce), 'X-Frame-Options': 'SAMEORIGIN', 'Cache-Control': 'no-store' } : {}, body: isSandbox ? readFileSync(file, 'utf8').replaceAll('__LASTUDIO_CAP_NONCE__', nonce) : readFileSync(file) })
    })
    const page = await context.newPage()
    await page.goto('https://fe-web.lastudio.cc/', { waitUntil: 'load' })
    await expect(page.getByRole('dialog')).toBeVisible()
    if (variant.nonce) {
      await expect(page.locator('.account-captcha')).toHaveAttribute('data-cap-display', 'error')
      await expect(page.getByRole('alert')).toContainText('验证组件未能加载')
      assert.equal(await page.locator('cap-widget').count(), 0)
      assert.equal(await page.evaluate(() => window.__capHarness.token), '')
      assert.equal((await page.evaluate(() => window.__capHarness.errors)).length, 1)
      await page.waitForTimeout(2600)
      assert.equal(challenges, 0, 'A style failure must not leave background verification running.')
      console.log(`PASS ${variant.name}: real component fails closed, no giant SVG or token`)
    } else {
      await expect(page.locator('.account-captcha')).toHaveAttribute('data-cap-display', 'ready')
      const surface = page.locator('cap-widget .captcha')
      await expect.poll(async () => Math.abs((await surface.boundingBox()).height - 58)).toBeLessThan(0.5)
      assert.equal(await surface.evaluate(element => getComputedStyle(element).height), '58px')
      const result = await page.evaluate(async () => {
        const widget = document.querySelector('cap-widget')
        const result = await widget.solve()
        return { success: result.success, token: result.token, fill: getComputedStyle(widget.shadowRoot.querySelector('circle')).fill }
      })
      assert.equal(result.success, true)
      assert.equal(result.fill, 'none')
      await expect.poll(() => page.evaluate(() => window.__capHarness.token)).toBe(result.token)
      assert.equal((await cap.validateToken(result.token)).success, true)
      assert.equal((await cap.validateToken(result.token)).success, false)
      const violations = await page.evaluate(() => window.__violations.filter(v => v.directive !== 'style-src-attr'))
      assert.deepEqual(violations, [])
      assert(requests.some(p => p.endsWith('/cap_wasm-0.0.7.wasm')))
      assert(requests.some(p => p.endsWith('/instrumentation-v1.html')))
      assert(!requests.some(p => p.includes('jsdelivr')))
      if (variant.fallback) assert(requests.some(p => p.endsWith('/pako_inflate-2.1.0.min.js')))
      console.log(`PASS ${variant.name}: actual Dialog/CAP, 58px, PoW, isolated instrumentation, single-use token`)
    }
    await context.close()
  }
} finally {
  await browser.close()
  rmSync(output, { recursive: true, force: true })
}
