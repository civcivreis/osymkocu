import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { toastError } from '@/src/components/ui/feedbackStore';
import { Screen } from '@/src/components/ui/Screen';
import { SegmentedTabs } from '@/src/components/ui/SegmentedTabs';
import {
    countdownLabel,
    examTypeLabel,
    formatIstanbulDateTime,
    type SystemExamListItem,
} from '@/src/features/system-exams/examTime';
import {
    mapExamError,
    useStartSystemExam,
    useSystemExams,
    useToggleExamSignup,
} from '@/src/features/system-exams/useSystemExams';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Tab = 'upcoming' | 'live' | 'past';

export function SystemExamsScreen() {
  const { colors } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const [tab, setTab] = useState<Tab>('upcoming');
  const list = useSystemExams(tab);
  const signup = useToggleExamSignup();
  const start = useStartSystemExam();

  return (
    <Screen scroll>
      <View style={{ gap: 14, paddingBottom: 28 }}>
        <PageHeader title="Sistem Sınavları" />
        {isDesktop ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <AppText variant="subtitle">Sistem Sınavları</AppText>
        </View>
        )}
        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'upcoming', label: 'Yaklaşan' },
            { value: 'live', label: 'Canlı' },
            { value: 'past', label: 'Geçmiş' },
          ]}
        />
        {list.isLoading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
        {list.isError ? <AppText tone="danger">Sınav listesi alınamadı. 0031 SQL’ini çalıştır.</AppText> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        {(list.data ?? [])
          .filter((exam) => (tab === 'past' ? Boolean(exam.attempt_id) : true))
          .map((exam) => (
          <View key={exam.id} style={{ width: isDesktop ? '31.5%' : '100%', flexGrow: 1, minWidth: isDesktop ? 260 : undefined }}>
          <ExamCard
            exam={exam}
            onRemind={() =>
              void signup.mutateAsync(exam.id).catch((error: unknown) =>
                toastError(error instanceof Error ? mapExamError(error.message) : error),
              )
            }
            onStart={() => {
              if (exam.attempt_id && exam.attempt_status !== 'in_progress') {
                router.push({ pathname: '/system-exam-result', params: { attemptId: exam.attempt_id, examId: exam.id } });
                return;
              }
              void start.mutateAsync(exam.id).then(
                (play) => router.push({ pathname: '/system-exam', params: { attemptId: play.attempt.id } }),
                (error: unknown) => toastError(error instanceof Error ? mapExamError(error.message) : error),
              );
            }}
            onResult={() => {
              if (exam.attempt_id) {
                router.push({ pathname: '/system-exam-result', params: { attemptId: exam.attempt_id, examId: exam.id } });
              }
            }}
          />
          </View>
        ))}
        </View>
        {!list.isLoading &&
        (tab === 'past' ? (list.data ?? []).filter((exam) => exam.attempt_id) : list.data ?? []).length === 0 ? (
          <EmptyState
            icon="school-outline"
            title={tab === 'upcoming' ? 'Yaklaşan sistem sınavı yok.' : tab === 'live' ? 'Şu an açık sınav yok.' : 'Katıldığın geçmiş sınav yok.'}
          />
        ) : null}
      </View>
    </Screen>
  );
}

function ExamCard({
  exam,
  onRemind,
  onStart,
  onResult,
}: {
  exam: SystemExamListItem;
  onRemind: () => void;
  onStart: () => void;
  onResult: () => void;
}) {
  const { colors } = useAppTheme();
  const when = formatIstanbulDateTime(exam.start_at);
  const live = exam.status === 'live';
  const past = exam.status === 'finished';
  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 8 }}>
      <AppText variant="caption" tone="accent">
        {examTypeLabel(exam.exam_type)} Sistem Sınavı
      </AppText>
      <AppText variant="subtitle">{exam.title}</AppText>
      <AppText variant="caption" tone="muted">
        {when.day}
      </AppText>
      <AppText variant="caption" tone="muted">
        {when.time}
      </AppText>
      <AppText variant="caption" tone="muted">
        {exam.question_count} soru • {exam.duration_minutes} dk
      </AppText>
      {exam.status === 'scheduled' ? (
        <AppText variant="label" tone="accent">
          {countdownLabel(exam.start_at)}
        </AppText>
      ) : null}
      {typeof exam.signup_count === 'number' && exam.signup_count > 0 ? (
        <AppText variant="caption" tone="muted">
          {exam.signup_count} kişi kayıtlı
          {live && exam.live_count ? ` • ${exam.live_count} kişi şu an sınavda` : ''}
        </AppText>
      ) : live && exam.live_count ? (
        <AppText variant="caption" tone="muted">
          {exam.live_count} kişi şu an sınavda
        </AppText>
      ) : null}
      {exam.description ? (
        <AppText variant="caption" tone="muted">
          {exam.description}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        {exam.status === 'scheduled' ? (
          <Pressable
            onPress={onRemind}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: exam.reminded ? colors.bgMuted : colors.accent,
            }}>
            <AppText variant="label" tone={exam.reminded ? 'primary' : 'inverse'}>
              {exam.reminded ? 'Hatırlatma açık' : 'Hatırlat'}
            </AppText>
          </Pressable>
        ) : null}
        {live ? (
          <Pressable
            onPress={onStart}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accent,
            }}>
            <AppText variant="label" tone="inverse">
              {exam.attempt_status === 'in_progress' ? 'Devam et' : exam.attempt_id ? 'Sonuç' : 'Başla'}
            </AppText>
          </Pressable>
        ) : null}
        {past && exam.attempt_id ? (
          <Pressable
            onPress={onResult}
            style={{
              flex: 1,
              minHeight: 44,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accent,
            }}>
            <AppText variant="label" tone="inverse">
              Sonucum
              {exam.score != null ? ` • ${exam.score} net` : ''}
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}
