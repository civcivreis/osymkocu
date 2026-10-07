import type { RealtimeChannel } from '@supabase/supabase-js';

import { getSupabase } from '@/src/lib/supabase/client';

type Live = {
  channel: RealtimeChannel;
  refs: number;
};

const live = new Map<string, Live>();

function topicOf(channel: RealtimeChannel) {
  return channel.topic.replace(/^realtime:/, '');
}

function dropMatching(name: string) {
  const supabase = getSupabase();
  for (const channel of supabase.getChannels()) {
    if (topicOf(channel) === name) {
      void supabase.removeChannel(channel);
    }
  }
}

/**
 * One postgres_changes channel per topic. Handlers are attached only on first
 * subscribe. Later retainers share the live channel instead of calling `.on()` after `subscribe()`.
 */
export function retainChannel(name: string, attach: (channel: RealtimeChannel) => RealtimeChannel) {
  const existing = live.get(name);
  if (existing) {
    existing.refs += 1;
    return () => releaseChannel(name);
  }

  dropMatching(name);
  const channel = attach(getSupabase().channel(name)).subscribe((status, err) => {
    if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      console.warn('[realtime]', name, status, err ?? '');
    }
  });
  live.set(name, { channel, refs: 1 });
  return () => releaseChannel(name);
}

export function releaseChannel(name: string) {
  const entry = live.get(name);
  if (!entry) return;
  entry.refs -= 1;
  if (entry.refs > 0) return;
  live.delete(name);
  void getSupabase().removeChannel(entry.channel);
}

export function releaseUserChannels(userId: string) {
  for (const name of [...live.keys()]) {
    if (name.includes(userId)) {
      const entry = live.get(name);
      live.delete(name);
      if (entry) void getSupabase().removeChannel(entry.channel);
    }
  }
}
