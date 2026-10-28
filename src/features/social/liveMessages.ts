import type { QueryClient } from '@tanstack/react-query';
import { AppState, Platform } from 'react-native';

import { chatPreview } from '@/src/features/social/chatMedia';
import type { InboxPayload } from '@/src/features/social/useInbox';
import type { DmMessage, GroupMessage } from '@/src/features/social/useSocial';
import { getSupabase } from '@/src/lib/supabase/client';

type ThreadKind = 'dm' | 'group';

const activeThread: Record<ThreadKind, string | null> = { dm: null, group: null };
const unreadApplied = new Set<string>();

export function setActiveThread(kind: ThreadKind, id: string | null) {
  activeThread[kind] = id;
}

export function getActiveThread(kind: ThreadKind) {
  return activeThread[kind];
}

export function isForeground() {
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    return document.visibilityState === 'visible';
  }
  return AppState.currentState === 'active';
}

export function watchingThread(kind: ThreadKind, id: string) {
  return Boolean(id) && isForeground() && activeThread[kind] === id;
}

function sortByTime<T extends { id: string; created_at: string }>(rows: T[]) {
  return [...rows].sort((left, right) => {
    const delta = Date.parse(left.created_at) - Date.parse(right.created_at);
    return delta !== 0 ? delta : left.id.localeCompare(right.id);
  });
}

function sortInboxDms(rows: InboxPayload['dms']) {
  return [...rows].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return (b.last_at ? Date.parse(b.last_at) : 0) - (a.last_at ? Date.parse(a.last_at) : 0);
  });
}

function sortInboxGroups(rows: InboxPayload['groups']) {
  return [...rows].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    return (b.last_at ? Date.parse(b.last_at) : 0) - (a.last_at ? Date.parse(a.last_at) : 0);
  });
}

export function upsertChatRow<T extends { id: string; sender_id: string; body: string; created_at: string }>(
  rows: T[] | undefined,
  incoming: T,
): T[] {
  const list = rows ?? [];
  if (list.some((row) => row.id === incoming.id)) {
    return sortByTime(list.map((row) => (row.id === incoming.id ? { ...row, ...incoming } : row)));
  }
  const next = list.filter((row) => {
    if (!String(row.id).startsWith('local-')) return true;
    if (row.sender_id !== incoming.sender_id) return true;
    if ((row.body ?? '') !== (incoming.body ?? '')) return true;
    const gap = Math.abs(Date.parse(row.created_at) - Date.parse(incoming.created_at));
    return Number.isFinite(gap) && gap > 20_000;
  });
  return sortByTime([...next, incoming]);
}

function rememberUnread(id: string) {
  if (unreadApplied.has(id)) return false;
  unreadApplied.add(id);
  if (unreadApplied.size > 400) {
    unreadApplied.clear();
    unreadApplied.add(id);
  }
  return true;
}

function asDm(raw: Record<string, unknown> | null | undefined, fallbackConversation?: string): DmMessage | null {
  if (!raw?.id) return null;
  const conversationId = String(raw.conversation_id ?? fallbackConversation ?? '');
  const senderId = String(raw.sender_id ?? '');
  const createdAt = String(raw.created_at ?? '');
  if (!conversationId || !senderId || !createdAt) return null;
  return {
    id: String(raw.id),
    conversation_id: conversationId,
    sender_id: senderId,
    body: String(raw.body ?? ''),
    created_at: createdAt,
    kind: raw.kind === 'image' ? 'image' : 'text',
    image_path: typeof raw.image_path === 'string' ? raw.image_path : null,
    image_width: typeof raw.image_width === 'number' ? raw.image_width : null,
    image_height: typeof raw.image_height === 'number' ? raw.image_height : null,
    media_id: typeof raw.media_id === 'string' ? raw.media_id : null,
  };
}

function asGroup(raw: Record<string, unknown> | null | undefined, fallbackSlug?: string): GroupMessage | null {
  if (!raw?.id) return null;
  const slug = String(raw.slug ?? fallbackSlug ?? '');
  const senderId = String(raw.sender_id ?? '');
  const createdAt = String(raw.created_at ?? '');
  if (!slug || !senderId || !createdAt) return null;
  return {
    id: String(raw.id),
    slug,
    sender_id: senderId,
    body: String(raw.body ?? ''),
    created_at: createdAt,
    reply_to_id: typeof raw.reply_to_id === 'string' ? raw.reply_to_id : null,
    kind: raw.kind === 'image' ? 'image' : 'text',
    image_path: typeof raw.image_path === 'string' ? raw.image_path : null,
    image_width: typeof raw.image_width === 'number' ? raw.image_width : null,
    image_height: typeof raw.image_height === 'number' ? raw.image_height : null,
    media_id: typeof raw.media_id === 'string' ? raw.media_id : null,
  };
}

async function hydrateDm(raw: Record<string, unknown>, fallbackConversation?: string): Promise<DmMessage | null> {
  const ready = asDm(raw, fallbackConversation);
  if (ready) return ready;
  const id = String(raw.id ?? '');
  if (!id) return null;
  const { data } = await getSupabase()
    .from('dm_messages')
    .select('id, conversation_id, sender_id, body, created_at, kind, image_path, image_width, image_height, media_id')
    .eq('id', id)
    .maybeSingle();
  return asDm((data ?? null) as Record<string, unknown> | null, fallbackConversation);
}

async function hydrateGroup(raw: Record<string, unknown>, fallbackSlug?: string): Promise<GroupMessage | null> {
  const ready = asGroup(raw, fallbackSlug);
  if (ready) return ready;
  const id = String(raw.id ?? '');
  if (!id) return null;
  const { data } = await getSupabase()
    .from('exam_chat_messages')
    .select('id, slug, sender_id, body, created_at, reply_to_id, kind, image_path, image_width, image_height, media_id')
    .eq('id', id)
    .maybeSingle();
  return asGroup((data ?? null) as Record<string, unknown> | null, fallbackSlug);
}

function patchInboxDms(client: QueryClient, row: DmMessage, viewerId?: string) {
  const watching = watchingThread('dm', row.conversation_id);
  const mine = Boolean(viewerId && row.sender_id === viewerId);
  const bumpUnread = !mine && !watching && rememberUnread(`dm:${row.id}`);
  let found = false;
  client.setQueriesData<InboxPayload>({ queryKey: ['inbox'] }, (prev) => {
    if (!prev) return prev;
    const dms = prev.dms.map((item) => {
      if (item.conversation_id !== row.conversation_id) return item;
      found = true;
      return {
        ...item,
        last_body: chatPreview(row) || row.body,
        last_at: row.created_at,
        unread: mine || watching ? 0 : item.unread + (bumpUnread ? 1 : 0),
      };
    });
    if (!found) return prev;
    return { ...prev, dms: sortInboxDms(dms) };
  });
  if (!found) {
    void client.invalidateQueries({ queryKey: ['inbox'] });
    return;
  }
  if (watching && !mine) {
    void getSupabase().rpc('mark_thread_read', { p_kind: 'dm', p_thread: row.conversation_id });
  }
}

function patchInboxGroups(client: QueryClient, row: GroupMessage, viewerId?: string) {
  const watching = watchingThread('group', row.slug);
  const mine = Boolean(viewerId && row.sender_id === viewerId);
  const bumpUnread = !mine && !watching && rememberUnread(`group:${row.id}`);
  let found = false;
  client.setQueriesData<InboxPayload>({ queryKey: ['inbox'] }, (prev) => {
    if (!prev) return prev;
    const groups = prev.groups.map((item) => {
      if (item.slug !== row.slug) return item;
      found = true;
      return {
        ...item,
        last_sender_id: row.sender_id,
        last_body: chatPreview(row) || row.body,
        last_at: row.created_at,
        unread: mine || watching ? 0 : item.unread + (bumpUnread ? 1 : 0),
      };
    });
    if (!found) return prev;
    return { ...prev, groups: sortInboxGroups(groups) };
  });
  if (watching && !mine) {
    void getSupabase().rpc('mark_thread_read', { p_kind: 'group', p_thread: row.slug });
  }
}

export function applyDmMessage(client: QueryClient, row: DmMessage, viewerId?: string, opts?: { inbox?: boolean }) {
  client.setQueryData<DmMessage[]>(['dm-messages', row.conversation_id], (prev) => upsertChatRow(prev, row));
  if (opts?.inbox !== false) patchInboxDms(client, row, viewerId);
}

export function applyGroupMessage(client: QueryClient, row: GroupMessage, viewerId?: string, opts?: { inbox?: boolean }) {
  const key = ['group-messages', row.slug, 'tail-v2'] as const;
  client.setQueryData<GroupMessage[]>(key, (prev) => {
    const named =
      row.display_name || !prev
        ? row
        : {
            ...row,
            display_name: prev.find((item) => item.sender_id === row.sender_id)?.display_name,
            display_tag: prev.find((item) => item.sender_id === row.sender_id)?.display_tag,
          };
    return upsertChatRow(prev, named).slice(-300);
  });
  if (opts?.inbox !== false) patchInboxGroups(client, row, viewerId);
}

export async function onDmInsert(
  client: QueryClient,
  raw: Record<string, unknown>,
  viewerId?: string,
  fallbackConversation?: string,
  opts?: { inbox?: boolean },
) {
  const row = await hydrateDm(raw, fallbackConversation);
  if (!row) {
    if (fallbackConversation) {
      void client.invalidateQueries({ queryKey: ['dm-messages', fallbackConversation] });
    }
    if (opts?.inbox !== false) void client.invalidateQueries({ queryKey: ['inbox'] });
    return;
  }
  applyDmMessage(client, row, viewerId, opts);
}

export async function onGroupInsert(
  client: QueryClient,
  raw: Record<string, unknown>,
  viewerId?: string,
  fallbackSlug?: string,
  opts?: { inbox?: boolean },
) {
  const row = await hydrateGroup(raw, fallbackSlug);
  if (!row) {
    if (fallbackSlug) {
      void client.invalidateQueries({ queryKey: ['group-messages', fallbackSlug] });
    }
    if (opts?.inbox !== false) void client.invalidateQueries({ queryKey: ['inbox'] });
    return;
  }
  applyGroupMessage(client, row, viewerId, opts);
}
