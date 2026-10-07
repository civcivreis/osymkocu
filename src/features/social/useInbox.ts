import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { chatPreview } from '@/src/features/social/chatMedia';
import { retainChannel } from '@/src/lib/realtime/retainChannel';
import { getSupabase } from '@/src/lib/supabase/client';
import { isMissingRpcError, isRpcMissing, markRpcMissing } from '@/src/lib/supabase/rpcStatus';
import { useAuthStore } from '@/src/stores/authStore';

export type InboxKind = 'group' | 'dm';

export type InboxGroup = {
  slug: string;
  name: string;
  last_sender_id?: string | null;
  last_body: string | null;
  last_sender_name: string | null;
  last_at: string | null;
  unread: number;
  member_count: number;
  is_pinned: boolean;
  is_muted: boolean;
};

export type InboxDm = {
  conversation_id: string;
  other_id: string;
  other_name: string;
  other_tag: number | null;
  last_body: string | null;
  last_at: string | null;
  unread: number;
  is_pinned: boolean;
  is_muted: boolean;
  accepted_at: string | null;
  initiated_by: string;
};

export type InboxPayload = {
  groups: InboxGroup[];
  dms: InboxDm[];
};

function rpcMissing(error: { message?: string; code?: string; status?: number } | null) {
  return isMissingRpcError(error);
}

function metaKey(userId: string) {
  return `inbox-meta:${userId}`;
}

type LocalMeta = {
  reads: Record<string, string>;
  pins: string[];
  mutes: string[];
  hidden: string[];
};

async function loadMeta(userId: string): Promise<LocalMeta> {
  const raw = await AsyncStorage.getItem(metaKey(userId));
  if (!raw) return { reads: {}, pins: [], mutes: [], hidden: [] };
  try {
    const parsed = JSON.parse(raw) as LocalMeta;
    return {
      reads: parsed.reads ?? {},
      pins: parsed.pins ?? [],
      mutes: parsed.mutes ?? [],
      hidden: parsed.hidden ?? [],
    };
  } catch {
    return { reads: {}, pins: [], mutes: [], hidden: [] };
  }
}

async function saveMeta(userId: string, meta: LocalMeta) {
  await AsyncStorage.setItem(metaKey(userId), JSON.stringify(meta));
}

function threadId(kind: InboxKind, key: string) {
  return `${kind}:${key}`;
}

function sortGroups(rows: InboxGroup[]) {
  return [...rows].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    const ta = a.last_at ? Date.parse(a.last_at) : 0;
    const tb = b.last_at ? Date.parse(b.last_at) : 0;
    return tb - ta;
  });
}

function sortDms(rows: InboxDm[]) {
  return [...rows].sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1;
    const ta = a.last_at ? Date.parse(a.last_at) : 0;
    const tb = b.last_at ? Date.parse(b.last_at) : 0;
    return tb - ta;
  });
}

const GROUPS: { slug: string; name: string }[] = [
  { slug: 'tyt', name: 'TYT' },
  { slug: 'ayt', name: 'AYT' },
  { slug: 'kpss', name: 'KPSS' },
];

async function fallbackInbox(userId: string): Promise<InboxPayload> {
  const supabase = getSupabase();
  await supabase.rpc('ensure_my_exam_groups');
  const meta = await loadMeta(userId);
  const seeded: LocalMeta = { ...meta, reads: { ...meta.reads } };
  let dirty = false;
  for (const group of GROUPS) {
    const id = threadId('group', group.slug);
    if (!seeded.reads[id]) {
      seeded.reads[id] = new Date().toISOString();
      dirty = true;
    }
  }
  if (dirty) await saveMeta(userId, seeded);

  const groupMessages = await supabase
    .from('exam_chat_messages')
    .select('id, slug, sender_id, body, created_at, kind, image_path, media_id')
    .in('slug', ['tyt', 'ayt', 'kpss'])
    .lte('created_at', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(120);
  const [{ data: messages }, { data: members }, { data: convos }] = await Promise.all([
    groupMessages.error && /kind|image_path|media_id/i.test(groupMessages.error.message)
      ? supabase
          .from('exam_chat_messages')
          .select('id, slug, sender_id, body, created_at')
          .in('slug', ['tyt', 'ayt', 'kpss'])
          .lte('created_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(120)
      : Promise.resolve(groupMessages),
    supabase.from('exam_chat_members').select('slug, user_id').in('slug', ['tyt', 'ayt', 'kpss']),
    supabase
      .from('dm_conversations')
      .select('id, user_a, user_b, initiated_by, accepted_at, created_at')
      .or(`user_a.eq.${userId},user_b.eq.${userId}`),
  ]);

  const lastBySlug = new Map<
    string,
    { slug: string; sender_id: string; body: string; created_at: string; kind?: string | null; image_path?: string | null; media_id?: string | null }
  >();
  const unreadBySlug = new Map<string, number>();
  const senderIds = new Set<string>();
  for (const row of messages ?? []) {
    if (!lastBySlug.has(row.slug)) lastBySlug.set(row.slug, row);
    const readAt = seeded.reads[threadId('group', row.slug)];
    if (row.sender_id !== userId && readAt && Date.parse(row.created_at) > Date.parse(readAt)) {
      unreadBySlug.set(row.slug, (unreadBySlug.get(row.slug) ?? 0) + 1);
    }
    senderIds.add(row.sender_id);
  }
  const memberCount = new Map<string, number>();
  for (const row of members ?? []) {
    memberCount.set(row.slug, (memberCount.get(row.slug) ?? 0) + 1);
  }
  const { data: people } = senderIds.size
    ? await supabase.from('profiles').select('id, display_name').in('id', [...senderIds])
    : { data: [] as { id: string; display_name: string }[] };
  const names = new Map((people ?? []).map((item) => [item.id, item.display_name]));

  const groups = GROUPS.map((group) => {
    const last = lastBySlug.get(group.slug);
    const id = threadId('group', group.slug);
    return {
      slug: group.slug,
      name: group.name,
      last_sender_id: last?.sender_id ?? null,
      last_body: last ? chatPreview(last) || last.body : null,
      last_sender_name: last ? (names.get(last.sender_id) ?? null) : null,
      last_at: last?.created_at ?? null,
      unread: unreadBySlug.get(group.slug) ?? 0,
      member_count: memberCount.get(group.slug) ?? 0,
      is_pinned: seeded.pins.includes(id),
      is_muted: seeded.mutes.includes(id),
    };
  });

  const convoRows = convos ?? [];
  for (const row of convoRows) {
    const id = threadId('dm', row.id);
    if (!seeded.reads[id]) {
      seeded.reads[id] = new Date().toISOString();
      dirty = true;
    }
  }
  if (dirty) await saveMeta(userId, seeded);

  const otherIds = convoRows.map((row) => (row.user_a === userId ? row.user_b : row.user_a));
  const convoIds = convoRows.map((row) => row.id);
  const [{ data: others }, { data: dmMessages }] = await Promise.all([
    otherIds.length
      ? supabase.from('profiles').select('id, display_name, display_tag').in('id', otherIds)
      : Promise.resolve({ data: [] as { id: string; display_name: string; display_tag: number | null }[] }),
    convoIds.length
      ? supabase
          .from('dm_messages')
          .select('id, conversation_id, sender_id, body, created_at, kind, image_path, media_id')
          .in('conversation_id', convoIds)
          .order('created_at', { ascending: false })
      : Promise.resolve({
          data: [] as {
            conversation_id: string;
            sender_id: string;
            body: string;
            created_at: string;
            kind?: string | null;
            image_path?: string | null;
            media_id?: string | null;
          }[],
        }),
  ]);
  const otherMap = new Map((others ?? []).map((item) => [item.id, item]));
  const lastDm = new Map<
    string,
    { body: string; created_at: string; sender_id: string; kind?: string | null; image_path?: string | null; media_id?: string | null }
  >();
  const unreadDm = new Map<string, number>();
  for (const message of dmMessages ?? []) {
    if (!lastDm.has(message.conversation_id)) lastDm.set(message.conversation_id, message);
    const readAt = seeded.reads[threadId('dm', message.conversation_id)];
    if (message.sender_id !== userId && readAt && Date.parse(message.created_at) > Date.parse(readAt)) {
      unreadDm.set(message.conversation_id, (unreadDm.get(message.conversation_id) ?? 0) + 1);
    }
  }

  const dms: InboxDm[] = convoRows.map((row) => {
    const otherId = row.user_a === userId ? row.user_b : row.user_a;
    const other = otherMap.get(otherId);
    const last = lastDm.get(row.id);
    const id = threadId('dm', row.id);
    return {
      conversation_id: row.id,
      other_id: otherId,
      other_name: other?.display_name ?? 'Öğrenci',
      other_tag: other?.display_tag ?? null,
      last_body: last ? chatPreview(last) || last.body : null,
      last_at: last?.created_at ?? row.created_at,
      unread: unreadDm.get(row.id) ?? 0,
      is_pinned: seeded.pins.includes(id),
      is_muted: seeded.mutes.includes(id),
      accepted_at: row.accepted_at,
      initiated_by: row.initiated_by,
    };
  });

  return { groups: sortGroups(groups), dms: sortDms(dms) };
}

function applyHidden(payload: InboxPayload, hidden: string[]): InboxPayload {
  const skip = new Set(hidden);
  return {
    groups: payload.groups.filter((row) => !skip.has(threadId('group', row.slug))),
    dms: payload.dms.filter((row) => !skip.has(threadId('dm', row.conversation_id))),
  };
}

export function inboxUnreadTotal(inbox?: InboxPayload | null) {
  if (!inbox) return 0;
  const groups = inbox.groups.reduce((sum, row) => sum + (row.is_muted ? 0 : row.unread), 0);
  const dms = inbox.dms.reduce((sum, row) => sum + (row.is_muted ? 0 : row.unread), 0);
  return groups + dms;
}

export function useInbox() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['inbox', userId],
    enabled: Boolean(userId),
    retry: (count, error) => count < 1 && !rpcMissing(error as { message?: string }),
    refetchInterval: isRpcMissing('get_inbox') ? false : 6000,
    queryFn: async () => {
      const supabase = getSupabase();
      await supabase.rpc('pulse_exam_chats');
      const meta = await loadMeta(userId!);
      if (isRpcMissing('get_inbox')) {
        return applyHidden(await fallbackInbox(userId!), meta.hidden);
      }
      const { data, error } = await supabase.rpc('get_inbox');
      if (error) {
        if (rpcMissing(error)) {
          markRpcMissing('get_inbox');
          return applyHidden(await fallbackInbox(userId!), meta.hidden);
        }
        throw error;
      }
      const payload = data as InboxPayload;
      const sorted = {
        groups: sortGroups(payload.groups ?? []),
        dms: sortDms(payload.dms ?? []),
      };
      return applyHidden(sorted, meta.hidden);
    },
  });

  useEffect(() => {
    if (!userId) return;
    return retainChannel(`inbox:${userId}`, (channel) =>
      channel
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'exam_chat_messages' }, () => {
          void client.invalidateQueries({ queryKey: ['inbox', userId] });
          void client.invalidateQueries({ queryKey: ['group-messages'] });
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'dm_messages' }, () => {
          void client.invalidateQueries({ queryKey: ['inbox', userId] });
          void client.invalidateQueries({ queryKey: ['dm-conversations'] });
          void client.invalidateQueries({ queryKey: ['dm-messages'] });
        }),
    );
  }, [client, userId]);

  return query;
}

export function useMarkThreadRead() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: InboxKind; thread: string }) => {
      const { error } = await getSupabase().rpc('mark_thread_read', {
        p_kind: input.kind,
        p_thread: input.thread,
      });
      if (error && !rpcMissing(error)) throw error;
      if (userId && error && rpcMissing(error)) {
        const meta = await loadMeta(userId);
        meta.reads[threadId(input.kind, input.thread)] = new Date().toISOString();
        await saveMeta(userId, meta);
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
}

export function useToggleThreadPin() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: InboxKind; thread: string }) => {
      const { error } = await getSupabase().rpc('toggle_thread_pin', {
        p_kind: input.kind,
        p_thread: input.thread,
      });
      if (error && !rpcMissing(error)) throw error;
      if (userId && error && rpcMissing(error)) {
        const meta = await loadMeta(userId);
        const id = threadId(input.kind, input.thread);
        meta.pins = meta.pins.includes(id) ? meta.pins.filter((item) => item !== id) : [...meta.pins, id];
        await saveMeta(userId, meta);
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
}

export function useToggleThreadMute() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: InboxKind; thread: string }) => {
      const { error } = await getSupabase().rpc('toggle_thread_mute', {
        p_kind: input.kind,
        p_thread: input.thread,
      });
      if (error && !rpcMissing(error)) throw error;
      if (userId && error && rpcMissing(error)) {
        const meta = await loadMeta(userId);
        const id = threadId(input.kind, input.thread);
        meta.mutes = meta.mutes.includes(id) ? meta.mutes.filter((item) => item !== id) : [...meta.mutes, id];
        await saveMeta(userId, meta);
      }
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
}

export function useHideThread() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: InboxKind; thread: string }) => {
      if (!userId) return;
      if (input.kind === 'group') {
        await getSupabase().from('exam_chat_members').delete().eq('slug', input.thread).eq('user_id', userId);
      }
      const meta = await loadMeta(userId);
      const id = threadId(input.kind, input.thread);
      if (!meta.hidden.includes(id)) meta.hidden = [...meta.hidden, id];
      await saveMeta(userId, meta);
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['inbox'] }),
  });
}
