import { usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';

import { useMatchInviteStore } from '@/src/features/study/matchInviteStore';
import { usePairChatStore } from '@/src/features/study/pairChatStore';
import { StudyMatchSheet } from '@/src/features/study/StudyMatchSheet';
import { respondMatchOffer, type MatchOffer } from '@/src/features/study/useStudyPresence';
import { useRespondStudy } from '@/src/features/study/useStudyTogether';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

export function MatchInviteHost() {
  const pathname = usePathname();
  const incoming = useMatchInviteStore((s) => s.incoming);
  const setOffer = useMatchInviteStore((s) => s.setOffer);
  const setIncoming = useMatchInviteStore((s) => s.setIncoming);
  const clear = useMatchInviteStore((s) => s.clear);
  const userId = useAuthStore((s) => s.session?.user.id);
  const autoMatch = useAuthStore((s) => s.profile?.auto_match) !== false;
  const pairOpen = usePairChatStore((s) => Boolean(s.session));
  const respondManual = useRespondStudy();
  const [busy, setBusy] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const acted = useRef<string | null>(null);

  const quiet =
    pairOpen ||
    pathname === '/system-exam' ||
    pathname.startsWith('/system-exam') ||
    pathname === '/notifications';

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      setForeground(state === 'active');
      if (state === 'active' && userId && autoMatch) {
        void getSupabase()
          .rpc('get_my_match_offer')
          .then(({ data }) => setOffer((data as MatchOffer | null) ?? null));
      }
    });
    return () => sub.remove();
  }, [autoMatch, setOffer, userId]);

  useEffect(() => {
    if (!userId || !autoMatch) return undefined;
    const pull = async () => {
      const { data } = await getSupabase().rpc('get_my_match_offer');
      setOffer((data as MatchOffer | null) ?? null);
    };
    void pull();
    const channel = getSupabase()
      .channel(`match-invite-host-${userId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => void pull(),
      )
      .subscribe();
    return () => {
      void getSupabase().removeChannel(channel);
    };
  }, [autoMatch, setOffer, userId]);

  const incomingId = incoming?.requestId;
  const incomingWaiting = incoming?.waiting;
  const incomingVariant = incoming?.variant;
  const incomingExpired = incoming?.expired;

  useEffect(() => {
    if (!incomingId || incomingVariant !== 'auto' || incomingExpired || incomingWaiting) return;
    if (acted.current === incomingId) return;
    AnalyticsProvider.track('match_suggestion_shown', { offerId: incomingId });
  }, [incomingExpired, incomingId, incomingVariant, incomingWaiting]);

  if (!incoming || incoming.expired || quiet || !foreground) return null;
  if (incoming.variant === 'auto' && !autoMatch) return null;

  return (
    <StudyMatchSheet
      visible
      variant={incoming.variant}
      userId={incoming.userId}
      displayName={incoming.displayName}
      displayTag={incoming.displayTag}
      avatarUrl={incoming.avatarUrl}
      subjectName={incoming.subjectName}
      topicName={incoming.topicName}
      waiting={incoming.waiting}
      busy={busy || respondManual.isPending}
      onClose={() => {
        if (incoming.variant === 'auto') {
          AnalyticsProvider.track('match_suggestion_ignored', { offerId: incoming.requestId });
        }
        acted.current = incoming.requestId;
        clear(incoming.requestId);
      }}
      onPrimary={() => {
        setBusy(true);
        acted.current = incoming.requestId;
        if (incoming.variant === 'manual') {
          void respondManual
            .mutateAsync({ inviteId: incoming.requestId, accept: true })
            .then(() => clear(incoming.requestId))
            .catch((error: unknown) =>
              toastError(error),
            )
            .finally(() => setBusy(false));
          return;
        }
        void respondMatchOffer(incoming.requestId, true)
          .then((row) => {
            AnalyticsProvider.track('match_suggestion_accepted', { offerId: incoming.requestId });
            if (row?.session_id) {
              usePairChatStore.getState().attach({
                sessionId: row.session_id,
                otherName: row.other_name,
                otherId: row.other_id,
              });
              clear(incoming.requestId);
              return;
            }
            if (row?.status === 'pending') {
              setIncoming({ ...incoming, waiting: true });
              return;
            }
            clear(incoming.requestId);
          })
          .catch((error: unknown) =>
            toastError(error),
          )
          .finally(() => setBusy(false));
      }}
      onSecondary={() => {
        setBusy(true);
        acted.current = incoming.requestId;
        if (incoming.variant === 'manual') {
          void respondManual
            .mutateAsync({ inviteId: incoming.requestId, accept: false })
            .then(() => clear(incoming.requestId))
            .finally(() => setBusy(false));
          return;
        }
        void respondMatchOffer(incoming.requestId, false)
          .then(() => {
            AnalyticsProvider.track('match_suggestion_declined', { offerId: incoming.requestId });
            clear(incoming.requestId);
          })
          .finally(() => setBusy(false));
      }}
    />
  );
}
