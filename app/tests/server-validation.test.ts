/* The server boundary accepted any payload.
 *
 * Every `createServerFn` in `server/admin.ts` and `server/jobs.ts` used an
 * identity `.validator((input) => input)`, which type-checks nothing at
 * runtime. That matters more in the jobs than the signature suggests: they are
 * the functions that would carry a service-role client, so a payload that
 * reached a query builder unexamined would be running with privileges the
 * caller does not have.
 *
 * The database is the real backstop — uuid columns, CHECK constraints and NOT
 * NULL all reject the rest — so this is defence in depth, not the only fence.
 * The tests below check the shape of the fence rather than the consequence of
 * breaking it, because the consequence needs a live database this repo has
 * never had.
 */
const { readFileSync } = process.getBuiltinModule('node:fs') as typeof import('node:fs')
const { join } = process.getBuiltinModule('node:path') as typeof import('node:path')
import { describe, expect, it } from 'vitest'

const SERVER = join(import.meta.dirname, '..', 'src', 'server')
const admin = readFileSync(join(SERVER, 'admin.ts'), 'utf8')
const jobs = readFileSync(join(SERVER, 'jobs.ts'), 'utf8')

/**
 * Does this file still contain an identity `.validator()`?
 *
 * Three attempts at matching the call properly failed, all in the same way: the
 * regex has to understand where a TypeScript type annotation ends, and a
 * multi-line object literal gives it plenty of room to guess wrong. Each version
 * reported a false positive on a validator that *does* validate, and a green
 * run would have been a lie about the guard.
 *
 * So this stops parsing. The identity form has no `=>` before its `input` and
 * no `{` either — a validator that does anything returns an object literal or
 * throws. Matching the one shape that cannot be a real validator, `=> input)`
 * or `=> input\n`, is unambiguous in the other direction: it can only be the
 * thing we are looking for, and it cannot match a validator that transforms.
 */
function identityValidatorCount(source: string): number {
  return (source.match(/\.validator\(\s*\(?\s*input\b[^)]*\)?\s*=>\s*input\s*\)/g) ?? []).length
}

describe('the server boundary validates its payloads', () => {
  it('has no identity validator left in admin.ts or jobs.ts', () => {
    /* The shape of the old bug exactly: `.validator((input: T) => input)`. Any
       remaining one is an unvalidated server function, whatever its type says
       — a TypeScript type is erased at runtime.

       Matched on the BODY only. A first version matched the whole call and
       flagged `adminFn`'s own type annotation
       (`.validator((input: { target: string; … }) => …)`) as an identity
       validator, which it is not: the arrow there is a function that validates.
       Requiring the body to be exactly `input` is what distinguishes the two. */
    expect(
      identityValidatorCount(`${admin}\n${jobs}`),
      'an identity .validator() remains: the TypeScript type is erased at runtime, '
        + 'so this server function accepts any shape',
    ).toBe(0)
  })

  it('validates an admin target before it reaches a query, an RPC or the log', () => {
    /* `target` flows into `admin_set_paused`, `.eq('id', …)`, and
       `activity_log.entity_id`, and for `admin_adjust` into a `user_id`.
       Asserted in the VALIDATOR, not the handler: TanStack runs the validator
       before the handler, and an earlier version of this file put the checks in
       the handler while the validator stayed an identity — so the guard said
       "validated" while the boundary still passed anything through. */
    expect(admin).toMatch(/function validateTarget/)
    expect(admin).toMatch(/target: validateTarget\(input\?\.target\)/)
    /* The handler reads the validated value, never the raw input. */
    const handler = admin.slice(admin.indexOf('const { target, reason'))
    expect(handler).toMatch(/const \{ target, reason/)
    expect(handler).not.toMatch(/data\.target/)
  })

  it('bounds the operator reason, which is written to the audit log verbatim', () => {
    /* docs/08 makes `activity_log` the system of record. A 10 MB "reason" is a
       way to fill it, and nothing else in the stack limits the field. */
    expect(admin).toMatch(/MAX_REASON = 500/)
    expect(admin).toMatch(/reason_too_long/)
  })

  it('bounds every job payload by row count', () => {
    /* These are the service-role functions. An unbounded array is a memory and
       round-trip cost handed to whoever calls them. */
    expect(jobs).toMatch(/MAX_ROWS = 500/)
    expect(jobs).toMatch(/function rows</)
  })

  it('checks the user ids a job writes to, since it writes notifications', () => {
    /* `chartTimeNotify` inserts a `notifications` row for a caller-supplied
       `userId`, and `expireUnusedGroupCover` credits a caller-supplied
       `organiserId`. Before this, a malformed id reached the insert; the
       database refused it, and the function reported `persisted: 0` as though
       it had partly worked. */
    expect(jobs).toMatch(/userId: uuid\(row\?\.userId, 'invalid_user_id'\)/)
    expect(jobs).toMatch(/organiserId: uuid\(row\?\.organiserId, 'invalid_user_id'\)/)
  })

  it('validates the role a caller claims rather than passing it to the RPC', () => {
    expect(admin).toMatch(/input\?\.role !== 'admin' && input\?\.role !== 'support'/)
  })
})
