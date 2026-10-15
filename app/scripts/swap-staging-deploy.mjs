import { readFileSync, realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { execFileSync, spawnSync } from 'node:child_process'

export const expectedConfig = Object.freeze({
  name: 'swap-backend-staging',
  account_id: '71102e7a2d820fb4ca21119099163dfc',
  main: 'src/staging-worker.ts',
  compatibility_date: '2026-09-01',
  workers_dev: true,
  preview_urls: false,
})
export function validateConfig(config) {
  if (!config || JSON.stringify(Object.entries(config).sort()) !==
      JSON.stringify(Object.entries(expectedConfig).sort())) {
    throw new Error('Refusing unapproved staging config, target or bindings')
  }
}
export async function preflight(token, fetcher = fetch) {
  if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required')
  async function get(path, allowMissing = false) {
    const res = await fetcher('https://api.cloudflare.com/client/v4' + path, {
      headers: { Authorization: 'Bearer ' + token },
    })
    if (allowMissing && res.status === 404) return null
    if (!res.ok) throw new Error('Cloudflare read preflight failed: ' + res.status)
    const body = await res.json()
    if (!body.success) throw new Error('Cloudflare preflight rejected')
    return body.result
  }
  const verification = await get('/user/tokens/verify')
  if (verification.status !== 'active') throw new Error('Token is not active')
  const accounts = await get('/accounts')
  if (!Array.isArray(accounts) || !accounts.some(a => a.id === expectedConfig.account_id)) {
    throw new Error('Approved account is not visible')
  }
  const settings = await get('/accounts/' + expectedConfig.account_id +
    '/workers/scripts/' + expectedConfig.name + '/settings', true)
  // A new, empty staging runtime must never inherit existing secrets/bindings.
  if (settings && (!Array.isArray(settings.bindings) || settings.bindings.length)) {
    throw new Error('Existing staging Worker has unexpected bindings; review required')
  }
}
async function main() {
  const args = process.argv.slice(2)
  if (args.length !== 1 || !['--dry-run', '--deploy'].includes(args[0])) {
    throw new Error('Use exactly --dry-run or --deploy; target overrides are prohibited')
  }
  const app = fileURLToPath(new URL('../', import.meta.url))
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd: app, encoding: 'utf8' }).trim()
  if (realpathSync(app) !== realpathSync(root + '/app')) throw new Error('Unexpected config directory')
  const origin = execFileSync('git', ['config', '--get', 'remote.origin.url'], { cwd: root, encoding: 'utf8' }).trim()
  if (!/github\.com[/:]ayodhyamohanthy\/swap(?:\.git)?$/.test(origin)) throw new Error('Unexpected repository')
  const config = JSON.parse(readFileSync(app + 'wrangler.staging.json', 'utf8'))
  validateConfig(config)
  const deploy = args[0] === '--deploy'
  if (deploy) {
    if (execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()) {
      throw new Error('Commit and validate the clean tree before deployment')
    }
    if (process.env.CLOUDFLARE_ACCOUNT_ID &&
        process.env.CLOUDFLARE_ACCOUNT_ID !== expectedConfig.account_id) {
      throw new Error('Account environment override is prohibited')
    }
    await preflight(process.env.CLOUDFLARE_API_TOKEN)
  }
  // No inherited application/vendor secrets or alternate Wrangler config flags.
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'SYSTEMROOT'].flatMap(
    key => process.env[key] ? [[key, process.env[key]]] : [],
  ))
  env.WRANGLER_SEND_METRICS = 'false'
  if (deploy) {
    env.CLOUDFLARE_API_TOKEN = process.env.CLOUDFLARE_API_TOKEN
    env.CLOUDFLARE_ACCOUNT_ID = expectedConfig.account_id
  }
  const result = spawnSync('npx', ['--yes', 'wrangler@4.143.0', 'deploy',
    '--config', app + 'wrangler.staging.json', ...(deploy ? [] : ['--dry-run'])],
    { cwd: app, env, stdio: 'inherit' })
  if (result.error || result.status !== 0) throw new Error('Staging deployment command failed')
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
