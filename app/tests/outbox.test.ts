/* Offline chat outbox: queued on this device while offline, oldest-first
   flush when the connection returns (docs/08). */
import { beforeEach, describe, expect, it } from 'vitest'

import { enqueue, flush, pending, pendingCount } from '@/lib/outbox'

describe('chat outbox', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('queues and flushes oldest first', () => {
    expect(pending('c1')).toEqual([])
    enqueue('c1', 'hello')
    enqueue('c1', 'still there?')
    expect(pending('c1')).toEqual(['hello', 'still there?'])
    expect(flush('c1')).toEqual(['hello', 'still there?'])
    expect(pending('c1')).toEqual([])
  })

  it('keeps chats separate', () => {
    enqueue('c1', 'one')
    enqueue('c2', 'two')
    expect(flush('c1')).toEqual(['one'])
    expect(pending('c2')).toEqual(['two'])
  })

  it('ignores blank text and counts across chats', () => {
    enqueue('c1', '   ')
    expect(pending('c1')).toEqual([])
    enqueue('c1', 'a')
    enqueue('c2', 'b')
    enqueue('c2', 'c')
    expect(pendingCount()).toBe(3)
    flush('c1')
    expect(pendingCount()).toBe(2)
  })
})
