/* Locked-swap chat sync (docs/04 A12, schema part 4).
   Local-first sync bridge for chat messages:
   - When Supabase is configured and a session is active, read and insert rows into
     public.chats and public.messages under RLS.
   - When Supabase is unavailable, offline, or caller is unauthenticated, messages
     remain local-first (stored via outbox / in-memory state).
   - Never crashes on network/auth errors.
*/

import { getSupabase } from './supabase'
import { guardMessage } from './chat-guard'

export type ChatSyncClient = NonNullable<Awaited<ReturnType<typeof getSupabase>>>

export interface ChatMessageItem {
  id: string | number
  chatId?: string
  senderId?: string
  text: string
  mine: boolean
  hidden: boolean
  flaggedRisky?: boolean
  queued?: boolean
  createdAt?: string
}

export interface ChatRecord {
  id: string
  requestId: string
  createdAt: string
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isValidUuid(str: string): boolean {
  return UUID_REGEX.test(str)
}

/** Get or create chat row for a swap request. Returns null if offline / unauthenticated / invalid request ID. */
export async function getOrCreateChat(
  requestId: string,
  clientOverride?: ChatSyncClient | null,
): Promise<{ chatId: string | null; error?: string }> {
  if (!isValidUuid(requestId)) {
    return { chatId: null, error: 'invalid_uuid' }
  }
  const client = clientOverride === undefined ? await getSupabase() : clientOverride
  if (!client) {
    return { chatId: null, error: 'no_client' }
  }

  try {
    // 1. Try to find existing chat
    const { data: existing, error: selectErr } = await client
      .from('chats')
      .select('id, request_id, created_at')
      .eq('request_id', requestId)
      .maybeSingle()

    if (selectErr) {
      return { chatId: null, error: selectErr.message }
    }
    if (existing) {
      return { chatId: existing.id }
    }

    // 2. If not found, create new chat
    const { data: created, error: insertErr } = await client
      .from('chats')
      .insert({ request_id: requestId })
      .select('id')
      .single()

    if (insertErr) {
      // In case of race condition where chat was created concurrently
      const { data: retry } = await client
        .from('chats')
        .select('id')
        .eq('request_id', requestId)
        .maybeSingle()
      if (retry) return { chatId: retry.id }
      return { chatId: null, error: insertErr.message }
    }

    return { chatId: created.id }
  } catch (err) {
    return { chatId: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Load messages for a chat from Supabase. Oldest first. */
export async function fetchMessages(
  chatId: string,
  currentUserId?: string | null,
  clientOverride?: ChatSyncClient | null,
): Promise<{ messages: ChatMessageItem[]; error?: string }> {
  if (!isValidUuid(chatId)) {
    return { messages: [], error: 'invalid_chat_id' }
  }
  const client = clientOverride === undefined ? await getSupabase() : clientOverride
  if (!client) {
    return { messages: [], error: 'no_client' }
  }

  try {
    const { data, error } = await client
      .from('messages')
      .select('id, chat_id, sender_id, text, flagged_risky, created_at')
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })

    if (error) {
      return { messages: [], error: error.message }
    }

    const messages: ChatMessageItem[] = (data || []).map((row: any) => ({
      id: row.id,
      chatId: row.chat_id,
      senderId: row.sender_id,
      text: row.text,
      mine: Boolean(currentUserId && row.sender_id === currentUserId),
      hidden: Boolean(row.flagged_risky),
      flaggedRisky: Boolean(row.flagged_risky),
      queued: false,
      createdAt: row.created_at,
    }))

    return { messages }
  } catch (err) {
    return { messages: [], error: err instanceof Error ? err.message : String(err) }
  }
}

/** Send a message into Supabase messages table. Returns created message item or error. */
export async function sendMessage(
  chatId: string,
  senderId: string,
  text: string,
  clientOverride?: ChatSyncClient | null,
): Promise<{ message: ChatMessageItem | null; error?: string }> {
  const clean = text.trim()
  if (!clean) {
    return { message: null, error: 'empty_text' }
  }
  if (!isValidUuid(chatId)) {
    return { message: null, error: 'invalid_chat_id' }
  }

  // Pre-guard on client
  const guard = guardMessage(clean)

  const client = clientOverride === undefined ? await getSupabase() : clientOverride
  if (!client) {
    return { message: null, error: 'no_client' }
  }

  try {
    const { data, error } = await client
      .from('messages')
      .insert({
        chat_id: chatId,
        sender_id: senderId,
        text: clean,
        flagged_risky: guard.flagged,
      })
      .select('id, chat_id, sender_id, text, flagged_risky, created_at')
      .single()

    if (error) {
      return { message: null, error: error.message }
    }

    const created: ChatMessageItem = {
      id: data.id,
      chatId: data.chat_id,
      senderId: data.sender_id,
      text: data.text,
      mine: true,
      hidden: Boolean(data.flagged_risky),
      flaggedRisky: Boolean(data.flagged_risky),
      queued: false,
      createdAt: data.created_at,
    }
    return { message: created }
  } catch (err) {
    return { message: null, error: err instanceof Error ? err.message : String(err) }
  }
}
