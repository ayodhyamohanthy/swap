import { describe, expect, it } from 'vitest'
import {
  getOrCreateChat,
  fetchMessages,
  sendMessage,
  isValidUuid,
  type ChatSyncClient,
} from '@/lib/chat-sync'

describe('chat-sync module', () => {
  const validUuid = '12345678-1234-1234-1234-1234567890ab'
  const validUser = '87654321-4321-4321-4321-ba0987654321'

  it('validates UUIDs properly', () => {
    expect(isValidUuid(validUuid)).toBe(true)
    expect(isValidUuid('not-a-uuid')).toBe(false)
    expect(isValidUuid('req_123456')).toBe(false)
  })

  it('handles getOrCreateChat with no client gracefully', async () => {
    const res = await getOrCreateChat(validUuid, null)
    expect(res.chatId).toBeNull()
    expect(res.error).toBe('no_client')
  })

  it('rejects non-uuid requestId for getOrCreateChat', async () => {
    const res = await getOrCreateChat('req_demo', null)
    expect(res.chatId).toBeNull()
    expect(res.error).toBe('invalid_uuid')
  })

  it('finds existing chat if present', async () => {
    const fakeClient = {
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: { id: 'chat-uuid-1', request_id: validUuid, created_at: new Date().toISOString() },
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as ChatSyncClient

    const res = await getOrCreateChat(validUuid, fakeClient)
    expect(res.chatId).toBe('chat-uuid-1')
    expect(res.error).toBeUndefined()
  })

  it('creates chat if none exists', async () => {
    let inserted = false
    const fakeClient = {
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: null,
            }),
          }),
        }),
        insert: (_payload: any) => {
          inserted = true
          return {
            select: () => ({
              single: async () => ({
                data: { id: 'chat-uuid-created' },
                error: null,
              }),
            }),
          }
        },
      }),
    } as unknown as ChatSyncClient

    const res = await getOrCreateChat(validUuid, fakeClient)
    expect(inserted).toBe(true)
    expect(res.chatId).toBe('chat-uuid-created')
  })

  it('fetches messages ordered by created_at', async () => {
    const fakeClient = {
      from: (_table: string) => ({
        select: () => ({
          eq: () => ({
            order: async () => ({
              data: [
                {
                  id: 'msg-1',
                  chat_id: validUuid,
                  sender_id: validUser,
                  text: 'Hello berth neighbour',
                  flagged_risky: false,
                  created_at: '2026-09-27T10:00:00Z',
                },
                {
                  id: 'msg-2',
                  chat_id: validUuid,
                  sender_id: 'other-user',
                  text: 'Hi there',
                  flagged_risky: false,
                  created_at: '2026-09-27T10:01:00Z',
                },
                {
                  id: 'msg-3',
                  chat_id: validUuid,
                  sender_id: 'other-user',
                  text: 'Pay me cash 500 upi someone@upi',
                  flagged_risky: true,
                  created_at: '2026-09-27T10:02:00Z',
                },
              ],
              error: null,
            }),
          }),
        }),
      }),
    } as unknown as ChatSyncClient

    const res = await fetchMessages(validUuid, validUser, fakeClient)
    expect(res.error).toBeUndefined()
    expect(res.messages).toHaveLength(3)

    // Check mapping
    expect(res.messages[0].mine).toBe(true)
    expect(res.messages[0].hidden).toBe(false)

    expect(res.messages[1].mine).toBe(false)
    expect(res.messages[1].hidden).toBe(false)

    expect(res.messages[2].mine).toBe(false)
    expect(res.messages[2].hidden).toBe(true)
    expect(res.messages[2].flaggedRisky).toBe(true)
  })

  it('sends message with safety check flagging cash words', async () => {
    let insertedPayload: any = null
    const fakeClient = {
      from: (_table: string) => ({
        insert: (payload: any) => {
          insertedPayload = payload
          return {
            select: () => ({
              single: async () => ({
                data: {
                  id: 'new-msg-id',
                  ...payload,
                  created_at: new Date().toISOString(),
                },
                error: null,
              }),
            }),
          }
        },
      }),
    } as unknown as ChatSyncClient

    const res = await sendMessage(validUuid, validUser, 'Meet me near coach door', fakeClient)
    expect(res.message).not.toBeNull()
    expect(res.message?.text).toBe('Meet me near coach door')
    expect(res.message?.hidden).toBe(false)
    expect(insertedPayload.flagged_risky).toBe(false)

    const riskyRes = await sendMessage(validUuid, validUser, 'Send me money on gpay', fakeClient)
    expect(riskyRes.message?.hidden).toBe(true)
    expect(insertedPayload.flagged_risky).toBe(true)
  })
})
