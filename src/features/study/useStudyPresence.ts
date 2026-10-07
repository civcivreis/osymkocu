import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';
import { useMatchInviteStore } from '@/src/features/study/matchInviteStore';
import { usePairChatStore } from '@/src/features/study/pairChatStore';

export type MatchOffer = {
  id: string;
  subject_id: string;
  subject_name: string;
  topic_id?: string | null;
  topic_name?: string | null;
  other_id: string;
  other_name: string;
  other_tag?: number | null;
  other_avatar?: string | null;
  status: 'pending' | 'matched' | 'declined' | 'expired';
  session_id: string | null;
  expires_at: string;
  my_yes: boolean | null;
  expired?: boolean;
};

function mapMatchError(message: string): string {
  if (message.includes('EXPIRED')) return 'Teklif süresi doldu.';
  if (message.includes('NO_QUESTIONS')) return 'Bu derste henüz soru yok.';
  if (message.includes('NOT_FOUND')) return 'Teklif bulunamadı.';
  return message;
}

function isActiveOffer(value: MatchOffer | null): value is MatchOffer {
  return Boolean(value && (value.status === 'pending' || value.status === 'matched'));
}

export async function respondMatchOffer(offerId: string, accept: boolean) {
  const { data, error } = await getSupabase().rpc('respond_match_offer', {
    p_offer_id: offerId,
    p_accept: accept,
  });
  if (error) throw new Error(mapMatchError(error.message));
  return (data as MatchOffer | null) ?? null;
}

export function useStudyPresence(subjectId: string | undefined, enabled: boolean, topicId?: string | null) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const [offer, setOffer] = useState<MatchOffer | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const hiddenIds = useRef(new Set<string>());
  const joinedSession = useRef<string | null>(null);

  const applyOffer = useCallback((next: MatchOffer | null) => {
    if (isActiveOffer(next) && !hiddenIds.current.has(next.id)) {
      setOffer(next);
      useMatchInviteStore.getState().setOffer(next);
      return;
    }
    setOffer((current) => {
      if (current?.status === 'pending' && new Date(current.expires_at).getTime() > Date.now()) {
        return current;
      }
      if (current?.status === 'matched' && current.session_id) {
        return current;
      }
      return null;
    });
    if (!next || next.status !== 'pending' || next.expired) {
      useMatchInviteStore.getState().setOffer(next);
    }
  }, []);

  const refreshOffer = useCallback(async () => {
    const { data, error } = await getSupabase().rpc('get_my_match_offer');
    if (error) return;
    applyOffer((data as MatchOffer | null) ?? null);
  }, [applyOffer]);

  const pulse = useCallback(async () => {
    if (!subjectId || !enabled) return;
    let { data, error } = await getSupabase().rpc('heartbeat_study', {
      p_subject_id: subjectId,
      p_topic_id: topicId ?? null,
    });
    if (error && /could not find|schema cache|unexpected/i.test(error.message)) {
      const fallback = await getSupabase().rpc('heartbeat_study', { p_subject_id: subjectId });
      data = fallback.data;
      error = fallback.error;
    }
    if (error) return;
    applyOffer((data as MatchOffer | null) ?? null);
  }, [applyOffer, enabled, subjectId, topicId]);

  useEffect(() => {
    if (!enabled || !subjectId || !userId) {
      return;
    }

    void pulse();
    const beat = setInterval(() => void pulse(), 10_000);
    const app = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        void getSupabase().rpc('leave_presence');
        return;
      }
      void pulse();
    });
    const channel = getSupabase()
      .channel(`match-offers-${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'study_match_offers', filter: `user_a=eq.${userId}` },
        () => void refreshOffer(),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'study_match_offers', filter: `user_b=eq.${userId}` },
        () => void refreshOffer(),
      )
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => void refreshOffer(),
      )
      .subscribe();

    return () => {
      clearInterval(beat);
      app.remove();
      void getSupabase().removeChannel(channel);
      void getSupabase().rpc('leave_presence');
    };
  }, [enabled, pulse, refreshOffer, subjectId, userId]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);

  const secondsLeft =
    offer && now > 0 ? Math.max(0, Math.ceil((new Date(offer.expires_at).getTime() - now) / 1000)) : 15;

  const offerId = offer?.id;
  const offerStatus = offer?.status;

  useEffect(() => {
    if (!offerId || offerStatus !== 'pending' || secondsLeft > 0) return;
    void refreshOffer();
    const retry = setTimeout(() => void refreshOffer(), 2000);
    return () => clearTimeout(retry);
  }, [offerId, offerStatus, refreshOffer, secondsLeft]);

  useEffect(() => {
    const sessionId = offer?.session_id;
    if (!sessionId || offer?.status !== 'matched' || joinedSession.current === sessionId) return;
    joinedSession.current = sessionId;
    usePairChatStore.getState().attach({
      sessionId,
      otherName: offer.other_name,
      otherId: offer.other_id,
    });
  }, [offer?.other_id, offer?.other_name, offer?.session_id, offer?.status]);

  const respond = useCallback(
    async (accept: boolean) => {
      if (!offer) return null;
      setBusy(true);
      try {
        const data = await respondMatchOffer(offer.id, accept);
        if (!accept || !data) {
          hiddenIds.current.add(offer.id);
          setOffer(null);
          useMatchInviteStore.getState().clear(offer.id);
          return null;
        }
        setOffer(data);
        return data;
      } finally {
        setBusy(false);
      }
    },
    [offer],
  );

  const visibleOffer = enabled && offer?.status === 'pending' ? offer : null;

  return { offer: visibleOffer, secondsLeft, busy, respond };
}
