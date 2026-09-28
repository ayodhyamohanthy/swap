#!/usr/bin/env node
/* Preload that makes spending impossible, so "dry run" stops being a promise.
 *
 * USAGE
 *   NO_NET_LOG=/tmp/net.log node --import ./no-net.mjs ./safety-eval.mjs
 *
 * `--import` loads this before the script's own modules, so the first `fetch`
 * the script calls is already replaced. It rejects rather than throws, because
 * `fetch` is an async contract: a synchronous throw would escape a `.catch()`
 * the script may legitimately have written, turning a blocked call into a crash
 * somewhere unrelated.
 *
 * A blocked call is RECORDED before it is refused. "Something tried to spend"
 * is the interesting fact; a bare stack trace about a fake network error is
 * not, and the dry-run harness reports the recorded URLs so the culprit is
 * named instead of guessed at.
 */
import { appendFileSync } from 'node:fs'

const logPath = process.env.NO_NET_LOG

function record(url) {
  if (!logPath) return
  try {
    appendFileSync(logPath, `${String(url)}\n`)
  } catch {
    /* Never let the recorder mask the refusal it is recording. */
  }
}

globalThis.fetch = (url) => {
  record(url)
  return Promise.reject(new Error(`no-net.mjs blocked a network call to ${String(url)}`))
}
