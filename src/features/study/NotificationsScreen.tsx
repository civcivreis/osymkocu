import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Screen } from '@/src/components/ui/Screen';
import { SegmentedTabs } from '@/src/components/ui/SegmentedTabs';
import { taggedName } from '@/src/features/social/identity';
import { StudyMatchSheet } from '@/src/features/study/StudyMatchSheet';
import { respondMatchOffer } from '@/src/features/study/useStudyPresence';
import { usePairChatStore } from '@/src/features/study/pairChatStore';
import {
  type AppNotification,
  useNotifications,
  useRespondStudy,
} from '@/src/features/study/useStudyTogether';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

function isMatchKind(kind: AppNotification['kind']) {
  return kind === 'study_match_found' || kind === 'study_offer';
}

function isManualStudyKind(kind: AppNotification['kind']) {
  return kind === 'study_invite' || kind === 'study_request';
}

function isExpiredMatch(item: AppNotification) {
  const expires = item.payload?.expires_at;
  if (!expires) return false;
  const at = Date.parse(expires);
  return Number.isFinite(at) && at <= Date.now();
}

function titleFor(item: AppNotification) {
  const payload = item.payload ?? {};
  const name = taggedName(payload.from_name, payload.from_tag);
  const kind = item.kind;
  const topic = payload.topic_name ? `${payload.subject_name ?? 'Ders'} → ${payload.topic_name}` : payload.subject_name;
  if (kind === 'follow' || kind === 'new_follower') return `${name} seni takip etmeye başladı.`;
  if (kind === 'study_invite' || kind === 'study_request') {
    return `${name} seninle ${topic ?? 'bir ders'} çalışmak istiyor.`;
  }
  if (kind === 'study_request_accepted' || kind === 'study_accepted') return `${name} isteğini kabul etti.`;
  if (kind === 'study_request_declined') return `${name} çalışma isteğini şimdilik geçti.`;
  if (isMatchKind(kind)) {
    if (isExpiredMatch(item)) return `${name} ile eşleşme önerisi.`;
    return `${name} de şu anda ${topic ?? 'aynı ders'} çalışıyor.`;
  }
  if (kind === 'study_match_accepted') return `${name} eşleşmeyi kabul etti.`;
  if (kind === 'study_match_declined') return `${name} eşleşmeyi şimdilik geçti.`;
  if (kind === 'race_invite') return `${name} ${payload.subject_name ?? 'bir ders'} yarışması istiyor.`;
  if (kind === 'race_accepted') return `${name} yarışmayı kabul etti.`;
  if (kind === 'exam_started') return `${payload.subject_name ?? 'Sınav'} başlıyor.`;
  if (kind === 'study_ended') return `${name} odadan ayrıldı.`;
  if (kind === 'post_like') return `${name} paylaşımını beğendi.`;
  if (kind === 'post_comment') return `${name} paylaşımına yorum yaptı.`;
  if (kind === 'room_invite') return `${name} seni bir çalışma odasına davet etti.`;
  if (kind === 'system_exam_reminder') {
    if (payload.slot === '10m') return `${payload.title ?? 'Sistem sınavı'} 10 dakika sonra.`;
    if (payload.slot === '1h') return `${payload.title ?? 'Sistem sınavı'} 1 saat sonra.`;
    return `${payload.title ?? 'Sistem sınavı'} yarın.`;
  }
  if (kind === 'system_exam_live') return `${payload.title ?? 'Sistem sınavı'} başladı.`;
  if (kind === 'admin_broadcast' || kind === 'system') return payload.body ?? 'Duyuru';
  if (kind === 'account_warning') return 'Hesabınla ilgili bir uyarı var.';
  if (kind === 'message') return `${name} sana mesaj gönderdi.`;
  return payload.body ?? payload.title ?? 'Bildirim';
}

function openNotification(item: AppNotification) {
  const payload = item.payload ?? {};
  if ((item.kind === 'follow' || item.kind === 'new_follower') && payload.from_user) {
    router.push({ pathname: '/user', params: { userId: payload.from_user } });
    return;
  }
  if (item.kind === 'system_exam_reminder' || item.kind === 'system_exam_live' || item.kind === 'admin_broadcast' || item.kind === 'system') {
    router.push('/sistem-sinavlari');
    return;
  }
  if (item.kind === 'message' && payload.from_user) {
    router.push({ pathname: '/chat', params: { userId: payload.from_user } });
    return;
  }
  if ((item.kind === 'post_like' || item.kind === 'post_comment') && payload.from_user) {
    router.push({ pathname: '/user', params: { userId: payload.from_user, postId: payload.post_id } });
    return;
  }
  if (item.kind === 'room_invite' && payload.session_id) {
    router.push({ pathname: '/study-room', params: { sessionId: payload.session_id } });
    return;
  }
  if (payload.session_id) {
    usePairChatStore.getState().attach({
      sessionId: payload.session_id,
      otherName: taggedName(payload.from_name, payload.from_tag),
      otherId: payload.from_user,
    });
    router.push({ pathname: '/practice', params: { subjectId: payload.subject_id ?? '' } });
  }
}

export function NotificationsScreen() {
  const { colors, spacing } = useAppTheme();
  const notifications = useNotifications();
  const respond = useRespondStudy();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [sheet, setSheet] = useState<AppNotification | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = (notifications.data ?? []).filter((item) => (tab === 'unread' ? !item.read_at : true));
  const payload = sheet?.payload ?? {};

  return (
    <Screen scroll>
      <View style={{ gap: spacing.lg }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <AppText variant="subtitle">Bildirimler</AppText>
        </View>
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'all', label: 'Tümü' },
            { value: 'unread', label: 'Okunmamış' },
          ]}
        />

        {notifications.isLoading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
        {notifications.isError ? <AppText tone="danger">Bildirimler alınamadı.</AppText> : null}

        {rows.map((item) => {
          const invite = item.payload.invite_id;
          const matchExpired = isMatchKind(item.kind) && isExpiredMatch(item);
          const openSheet =
            (isMatchKind(item.kind) && item.payload.offer_id && !matchExpired) ||
            (isManualStudyKind(item.kind) && invite);
          return (
            <Card key={item.id}>
              <View style={{ gap: spacing.sm }}>
                <Pressable
                  onPress={() => {
                    void notifications.markRead.mutateAsync(item.id);
                    if (openSheet) {
                      setSheet(item);
                      return;
                    }
                    if (matchExpired) {
                      AnalyticsProvider.track('match_suggestion_expired', { offerId: item.payload.offer_id });
                      return;
                    }
                    openNotification(item);
                  }}>
                  <AppText>{titleFor(item)}</AppText>
                  {matchExpired ? (
                    <AppText variant="caption" tone="muted">
                      Bu eşleşmenin süresi doldu.
                    </AppText>
                  ) : null}
                  {item.read_at ? null : (
                    <AppText variant="caption" tone="accent">
                      Yeni
                    </AppText>
                  )}
                </Pressable>
                {item.kind === 'race_invite' && invite ? (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Kabul et"
                        loading={respond.isPending}
                        onPress={() => {
                          void respond
                            .mutateAsync({ inviteId: invite, accept: true })
                            .then((sessionId) => {
                              void notifications.markRead.mutateAsync(item.id);
                              if (sessionId) {
                                router.push({ pathname: '/study-room', params: { sessionId } });
                              }
                            })
                            .catch((error: unknown) =>
                              toastError(error),
                            );
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        label="Reddet"
                        variant="ghost"
                        onPress={() => {
                          void respond.mutateAsync({ inviteId: invite, accept: false });
                          void notifications.markRead.mutateAsync(item.id);
                        }}
                      />
                    </View>
                  </View>
                ) : null}
              </View>
            </Card>
          );
        })}

        {!notifications.isLoading && rows.length === 0 ? (
          <AppText tone="muted">{tab === 'unread' ? 'Okunmamış bildirim yok.' : 'Bildirim yok.'}</AppText>
        ) : null}
      </View>
      {sheet && (isMatchKind(sheet.kind) || isManualStudyKind(sheet.kind)) ? (
        <StudyMatchSheet
          visible
          variant={isMatchKind(sheet.kind) ? 'auto' : 'manual'}
          userId={payload.from_user ?? sheet.id}
          displayName={payload.from_name ?? 'Öğrenci'}
          displayTag={payload.from_tag}
          subjectName={payload.subject_name}
          topicName={payload.topic_name}
          busy={busy || respond.isPending}
          onClose={() => setSheet(null)}
          onPrimary={() => {
            setBusy(true);
            const offerId = payload.offer_id;
            const inviteId = payload.invite_id;
            if (isMatchKind(sheet.kind) && offerId) {
              void respondMatchOffer(offerId, true)
                .then((row) => {
                  AnalyticsProvider.track('match_suggestion_accepted', { offerId });
                  void notifications.markRead.mutateAsync(sheet.id);
                  if (row?.session_id) {
                    usePairChatStore.getState().attach({
                      sessionId: row.session_id,
                      otherName: row.other_name,
                      otherId: row.other_id,
                    });
                    router.push({ pathname: '/practice', params: { subjectId: row.subject_id } });
                  }
                  setSheet(null);
                })
                .catch((error: unknown) =>
                  toastError(error),
                )
                .finally(() => setBusy(false));
              return;
            }
            if (inviteId) {
              void respond
                .mutateAsync({ inviteId, accept: true })
                .then((sessionId) => {
                  void notifications.markRead.mutateAsync(sheet.id);
                  if (sessionId) router.push({ pathname: '/study-room', params: { sessionId } });
                  setSheet(null);
                })
                .catch((error: unknown) =>
                  toastError(error),
                )
                .finally(() => setBusy(false));
            }
          }}
          onSecondary={() => {
            setBusy(true);
            const offerId = payload.offer_id;
            const inviteId = payload.invite_id;
            if (isMatchKind(sheet.kind) && offerId) {
              void respondMatchOffer(offerId, false)
                .then(() => {
                  AnalyticsProvider.track('match_suggestion_declined', { offerId });
                  void notifications.markRead.mutateAsync(sheet.id);
                  setSheet(null);
                })
                .finally(() => setBusy(false));
              return;
            }
            if (inviteId) {
              void respond
                .mutateAsync({ inviteId, accept: false })
                .then(() => {
                  void notifications.markRead.mutateAsync(sheet.id);
                  setSheet(null);
                })
                .finally(() => setBusy(false));
            }
          }}
        />
      ) : null}
    </Screen>
  );
}
