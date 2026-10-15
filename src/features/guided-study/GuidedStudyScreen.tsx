import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { toastSuccess } from '@/src/components/ui/feedbackStore';
import { useXpFeedbackStore } from '@/src/features/progress/xpFeedbackStore';
import { usePublicExamCatalog } from '@/src/features/curriculum/useCurriculum';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

import { actGuided, startGuidedSession } from './api';
import type { GuidedNext } from './types';

function Chip({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        minHeight: 44,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: active ? colors.accent : colors.border,
        backgroundColor: active ? colors.accentMuted : colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <AppText>{label}</AppText>
    </Pressable>
  );
}

export function GuidedStudyScreen() {
  const { colors, radius } = useAppTheme();
  const params = useLocalSearchParams<{ sessionId?: string; mode?: string }>();
  const catalogs = usePublicExamCatalog();
  const profileExam = useAuthStore((s) => s.profile?.exam_id);
  const examId = catalogs.data?.[0]?.id ?? profileExam ?? null;
  const showXp = useXpFeedbackStore((s) => s.showToast);
  const [boot, setBoot] = useState(true);
  const [next, setNext] = useState<GuidedNext | null>(null);
  const [breakFreq, setBreakFreq] = useState(3);
  const [minutes, setMinutes] = useState(40);
  const [error, setError] = useState<string | null>(null);

  const apply = (row: GuidedNext) => {
    setNext(row);
    const xp = row.session?.xp_awarded;
    if (typeof xp === 'number' && xp > 0) {
      /* summary uses stored total */
    }
  };

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const started = await startGuidedSession(examId, params.mode === 'friend' ? 'friend' : 'solo');
        const id = String(params.sessionId || started.session.id);
        const { fetchGuidedNext } = await import('./api');
        const row = await fetchGuidedNext(id);
        if (!cancelled) apply(row);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Oturum açılamadı.');
      } finally {
        if (!cancelled) setBoot(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [examId, params.mode, params.sessionId]);

  const sessionId = next?.session.id;
  const act = async (action: string, payload: Record<string, unknown> = {}) => {
    if (!sessionId) return;
    const row = await actGuided(sessionId, action, payload);
    apply(row);
    return row;
  };

  if (boot) {
    return (
      <Screen>
        <AppText tone="muted">Koçun hazırlanıyor…</AppText>
      </Screen>
    );
  }
  if (error || !next) {
    return (
      <Screen>
        <AppText tone="danger">{error ?? 'Oturum yok.'}</AppText>
      </Screen>
    );
  }

  const action = next.next_action;
  const payload = next.payload ?? {};

  return (
    <Screen>
      <View style={{ gap: 16, paddingBottom: 40 }}>
        <Pressable onPress={() => router.back()}>
          <AppText tone="accent">← Ana sayfa</AppText>
        </Pressable>

        {action === 'greet' ? (
          <View style={{ gap: 14 }}>
            <AppText variant="title">Koçun</AppText>
            <AppText>{String(payload.text ?? '')}</AppText>
            <Pressable onPress={() => void act('greet_done')} style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Hazırım</AppText>
            </Pressable>
          </View>
        ) : null}

        {action === 'prefs' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">Molaları nasıl yapalım?</AppText>
            <AppText tone="muted">Bir ders ortalama 3–7 dakika sürecek.</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[
                [1, 'Her ders sonrası'],
                [2, '2 derste bir'],
                [3, '3 derste bir'],
                [0, 'Bana göre ayarla'],
              ].map(([val, label]) => (
                <Chip key={String(val)} label={String(label)} active={breakFreq === val} onPress={() => setBreakFreq(Number(val))} />
              ))}
            </View>
            <AppText variant="subtitle">Bugün kaç dakika?</AppText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[20, 40, 60, 90].map((val) => (
                <Chip key={val} label={`${val} dk`} active={minutes === val} onPress={() => setMinutes(val)} />
              ))}
            </View>
            <Pressable
              onPress={() =>
                void act('save_prefs', {
                  break_frequency_lessons: breakFreq,
                  preferred_session_minutes: minutes,
                  coach_autonomy_level: breakFreq === 0 ? 'automatic' : 'balanced',
                })
              }
              style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Devam</AppText>
            </Pressable>
          </View>
        ) : null}

        {action === 'how_we_study' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">Bu sistemde nasıl çalışacağız?</AppText>
            <AppText>Dersler 3–7 dakika. Kartlara cevap ver. Yanlışlar sinyaldir; aynı mantık doğru olana kadar döner. Günlük test yeni + eski karışımıdır. Molalar planlıdır.</AppText>
            <Pressable onPress={() => void act('how_we_study_done')} style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Anladım, plana geç</AppText>
            </Pressable>
          </View>
        ) : null}

        {action === 'show_plan' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">Bugünkü Plan</AppText>
            {(next.plan?.planned_items ?? []).some((item) => item.kind === 'unavailable') ? (
              <AppText>İçerik hazırlanıyor. Yayınlanmış ders veya test yok; sahte plan oluşturulmadı.</AppText>
            ) : null}
            {(next.plan?.planned_items ?? []).map((item, index) => (
              <View key={`${item.kind}-${index}`} style={{ padding: 12, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
                <AppText variant="subtitle">
                  {index + 1}. {String(item.title ?? item.kind)}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {String(item.subject ?? '')} {item.minutes ? `· ${String(item.minutes)} dk` : ''}
                </AppText>
              </View>
            ))}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pressable onPress={() => void act('mark_plan')} style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <AppText tone="inverse">Bireysel Çalış</AppText>
              </Pressable>
              <Pressable
                onPress={() => router.push('/study')}
                style={{ minHeight: 48, paddingHorizontal: 16, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                <AppText>Arkadaşla Çalış</AppText>
              </Pressable>
            </View>
          </View>
        ) : null}

        {action === 'next_lesson' || action === 'play_lesson' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">{action === 'play_lesson' ? 'Derse devam' : 'Sıradaki ders'}</AppText>
            <AppText>{String(payload.title ?? 'Mikro ders')}</AppText>
            <AppText tone="muted">İlerlemen kaydedildi. 3–7 dakikalık teknik ders.</AppText>
            <Pressable
              onPress={() => {
                const lessonId = String(payload.lesson_id ?? next.session.current_lesson_id ?? '');
                if (!lessonId || lessonId === 'null') {
                  toastSuccess('Bu konu için yayınlanmış ders henüz yok. Planındaki diğer maddeye geç.');
                  void act('skip_lesson', { lesson_id: payload.lesson_id ?? '' });
                  return;
                }
                void act('start_lesson', { lesson_id: lessonId }).then(() => {
                  router.push({
                    pathname: '/dersler/hafiza/[lessonId]',
                    params: { lessonId, sessionId, examCatalogId: examId ?? '' },
                  });
                });
              }}
              style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Dersi aç</AppText>
            </Pressable>
          </View>
        ) : null}

        {action === 'start_break' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">Kısa mola</AppText>
            <AppText>
              {String(payload.lessons ?? next.session.completed_lessons)} kısa dersi tamamladın. {String(payload.elapsed ?? next.elapsed_minutes)} dakikadır çalışıyoruz.{' '}
              {String(payload.minutes ?? 5)} dakika mola iyi gelir.
            </AppText>
            {next.fatigue ? <AppText>Son sorularda doğruluk biraz düştü. Molayı atlama.</AppText> : null}
            <Pressable onPress={() => void act('start_break')} style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Mola Başlat</AppText>
            </Pressable>
            <Pressable onPress={() => void act('skip_break')} style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="accent">Molasız Devam Et</AppText>
            </Pressable>
          </View>
        ) : null}

        {action === 'start_test' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">Günlük test</AppText>
            <AppText>Bugünün dersleri, zayıf noktalar ve tekrar karışımı. Yanlışlar test bitmeden aynı mantıkla döner.</AppText>
            <Pressable
              onPress={() => {
                const ids = Array.isArray(payload.question_ids) ? (payload.question_ids as string[]).filter(Boolean).join(',') : '';
                router.push({
                  pathname: '/practice',
                  params: {
                    examCatalogId: examId ?? '',
                    setType: 'daily_guided',
                    sessionId,
                    count: '20',
                    questionIds: ids,
                  },
                });
              }}
              style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Teste başla</AppText>
            </Pressable>
          </View>
        ) : null}

        {action === 'repeat_wrong_question' || action === 'needs_review' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">{action === 'needs_review' ? 'Tekrar listesine alındı' : 'Hadi bu noktayı sağlamlaştıralım'}</AppText>
            <AppText>{String(payload.message ?? '')}</AppText>
            {action === 'repeat_wrong_question' ? (
              <Pressable
                onPress={() => {
                  const lessonId = String(payload.lesson_id ?? next.session.current_lesson_id ?? '');
                  if (lessonId) {
                    router.push({ pathname: '/dersler/hafiza/[lessonId]', params: { lessonId, sessionId, mode: 'review' } });
                  }
                }}
                style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <AppText tone="inverse">Eşdeğer soruyu aç</AppText>
              </Pressable>
            ) : (
              <Pressable onPress={() => void act('clear_skill', { objective_key: payload.objective_key })} style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
                <AppText tone="inverse">Devam</AppText>
              </Pressable>
            )}
          </View>
        ) : null}

        {action === 'show_result' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">İlerlemen kaydedildi</AppText>
            <AppText>Şimdi sıradaki derse geçiyoruz.</AppText>
            <AppText>
              {next.session.completed_lessons} ders · {next.session.questions_answered} soru · {next.session.correct_count} doğru
            </AppText>
            <Pressable onPress={() => void act('mark_plan')} style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Şimdi geç</AppText>
            </Pressable>
            <Pressable onPress={() => void act('start_break')} style={{ minHeight: 44, alignItems: 'center' }}>
              <AppText tone="accent">1 dk mola</AppText>
            </Pressable>
          </View>
        ) : null}

        {action === 'complete_session' ? (
          <View style={{ gap: 12 }}>
            <AppText variant="title">Bugünlük plan</AppText>
            <AppText>
              {next.session.completed_lessons} ders · {next.elapsed_minutes} dk · {next.session.questions_answered} soru · {next.session.correct_count} doğru · {next.session.wrong_count} yanlış
            </AppText>
            <AppText variant="subtitle">+{next.session.xp_awarded} XP</AppText>
            <Pressable
              onPress={() => {
                void act('complete_session').then((row) => {
                  if (row?.session.xp_awarded) showXp(row.session.xp_awarded, 'Oturum');
                  toastSuccess('Bugünlük plan kaydedildi.');
                  router.replace('/home');
                });
              }}
              style={{ minHeight: 48, borderRadius: 14, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Bitir</AppText>
            </Pressable>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}
