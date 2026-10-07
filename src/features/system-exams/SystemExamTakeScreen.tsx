import { useLocalSearchParams, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Pressable, ScrollView, View } from 'react-native';

import { ActionSheet } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { Screen } from '@/src/components/ui/Screen';
import { clockLabel, type SystemExamPlay } from '@/src/features/system-exams/examTime';
import {
  mapExamError,
  useSaveSystemExamAnswer,
  useSubmitSystemExam,
  useSystemExamPlay,
} from '@/src/features/system-exams/useSystemExams';
import { QuestionPalette } from '@/src/features/study/QuestionPalette';
import { sortedChoices } from '@/src/features/study/usePractice';
import { getSupabase } from '@/src/lib/supabase/client';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

export function SystemExamTakeScreen() {
  const params = useLocalSearchParams<{ attemptId?: string }>();
  const attemptId = String(params.attemptId ?? '');
  const playQuery = useSystemExamPlay(attemptId || null);

  useEffect(() => {
    useCoachStore.getState().setCoachLocked(true);
    return () => useCoachStore.getState().setCoachLocked(false);
  }, []);

  if (playQuery.isError) {
    return (
      <Screen>
        <AppText tone="danger">Sınav yüklenemedi.</AppText>
      </Screen>
    );
  }

  if (!playQuery.data) {
    return (
      <Screen>
        <AppText tone="muted">Sorular yükleniyor…</AppText>
      </Screen>
    );
  }

  return <ExamTakeInner attemptId={attemptId} play={playQuery.data} />;
}

function ExamTakeInner({ attemptId, play }: { attemptId: string; play: SystemExamPlay }) {
  const { colors } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const save = useSaveSystemExamAnswer();
  const submit = useSubmitSystemExam();
  const questions = play.questions;
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [index, setIndex] = useState(() =>
    Math.min(play.attempt.current_question_index, Math.max(0, questions.length - 1)),
  );
  const [remain, setRemain] = useState<number | null>(play.attempt.remaining_seconds);

  useEffect(() => {
    const tick = setInterval(() => {
      setRemain((value) => (value == null ? value : Math.max(0, value - 1)));
    }, 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (remain !== 0 || play.attempt.status !== 'in_progress') return;
    void submit.mutateAsync(attemptId).then(() => {
      router.replace({ pathname: '/system-exam-result', params: { attemptId, examId: play.exam.id } });
    });
  }, [attemptId, play.attempt.status, play.exam.id, remain, submit]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      void getSupabase().rpc('log_system_exam_event', {
        p_attempt: attemptId,
        p_kind: state === 'active' ? 'foreground' : 'background',
        p_metadata: { state },
      });
    });
    return () => sub.remove();
  }, [attemptId]);

  const question = questions[index];
  const finish = () => setConfirmFinish(true);

  const submitExam = () => {
    setConfirmFinish(false);
    void submit.mutateAsync(attemptId).then(
      () => router.replace({ pathname: '/system-exam-result', params: { attemptId, examId: play.exam.id } }),
      (error: unknown) => toastError(error instanceof Error ? mapExamError(error.message) : error),
    );
  };

  const pick = (option: string | null, marked?: boolean) => {
    if (!question) return;
    void save
      .mutateAsync({
        attemptId,
        questionId: question.id,
        option,
        marked,
        index,
      })
      .then((row) => {
        if (row.remaining_seconds != null) setRemain(row.remaining_seconds);
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : '';
        if (message.includes('EXAM_TIME_UP')) {
          router.replace({ pathname: '/system-exam-result', params: { attemptId, examId: play.exam.id } });
          return;
        }
        toastError(mapExamError(message));
      });
  };

  const palette = (
    <QuestionPalette
      current={index}
      onSelect={setIndex}
      items={questions.map((item) => ({
        id: item.id,
        answered: Boolean(item.selected_option),
        marked: Boolean(item.marked_for_review),
      }))}
    />
  );

  const questionBody = question ? (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 24 }}>
      {question.image_url ? (
        <RemoteImage
          uri={question.image_url}
          accessibilityLabel="Soru görseli"
          resizeMode="contain"
          style={{ width: '100%', height: 220, borderRadius: 12 }}
        />
      ) : null}
      <AppText variant="subtitle">{question.stem}</AppText>
      {sortedChoices(question.choices).map((choice) => {
        const selected = question.selected_option === choice.key;
        return (
          <Pressable
            key={choice.key}
            onPress={() => pick(choice.key)}
            style={{
              padding: 14,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: selected ? colors.accent : colors.border,
              backgroundColor: selected ? colors.accentMuted : colors.surface,
            }}>
            <AppText>
              {choice.key}) {choice.label}
            </AppText>
          </Pressable>
        );
      })}
      <Pressable onPress={() => pick(question.selected_option ?? null, !question.marked_for_review)}>
        <AppText tone="accent">{question.marked_for_review ? 'İşaret kaldır' : 'Gözden geçir'}</AppText>
      </Pressable>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Pressable
          onPress={() => setIndex((value) => Math.max(0, value - 1))}
          style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.bgMuted }}>
          <AppText>Önceki</AppText>
        </Pressable>
        <Pressable
          onPress={() => setIndex((value) => Math.min(questions.length - 1, value + 1))}
          style={{ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.bgMuted }}>
          <AppText>Sonraki</AppText>
        </Pressable>
      </View>
      {isDesktop ? null : (
        <Pressable
          onPress={finish}
          style={{ minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy }}>
          <AppText variant="label" tone="inverse">
            Sınavı bitir
          </AppText>
        </Pressable>
      )}
    </ScrollView>
  ) : (
    <AppText tone="muted">Soru yok.</AppText>
  );

  const side = (
    <View style={{ gap: 12, width: 220 }}>
      <AppText variant="title" tone={(remain ?? 99) < 60 ? 'danger' : 'accent'}>
        {remain == null ? '--:--' : clockLabel(remain)}
      </AppText>
      <AppText variant="caption" tone="muted">
        {play.exam.title}
      </AppText>
      <AppText>
        Cevaplanan {questions.filter((item) => item.selected_option).length} / {questions.length}
      </AppText>
      {question ? (
        <Pressable onPress={() => pick(question.selected_option ?? null, !question.marked_for_review)}>
          <AppText tone="accent">{question.marked_for_review ? 'İşareti kaldır' : 'Gözden geçir'}</AppText>
        </Pressable>
      ) : null}
      <Pressable
        onPress={finish}
        style={{ minHeight: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.navy }}>
        <AppText variant="label" tone="inverse">
          Sınavı bitir
        </AppText>
      </Pressable>
    </View>
  );

  return (
    <Screen scroll={false} safeEdges={['top']}>
      <View style={{ flex: 1, gap: 10 }}>
        {isDesktop ? (
          <View style={{ flexDirection: 'row', flex: 1, gap: 16 }}>
            <View style={{ width: 160 }}>
              <ScrollView>{palette}</ScrollView>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 8 }}>
              <AppText variant="label">{play.exam.title}</AppText>
              {questionBody}
            </View>
            {side}
          </View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <AppText variant="label">{play.exam.title}</AppText>
              <AppText variant="title" tone={(remain ?? 99) < 60 ? 'danger' : 'accent'}>
                {remain == null ? '--:--' : clockLabel(remain)}
              </AppText>
            </View>
            <AppText variant="caption" tone="muted">
              Soru {questions.length ? index + 1 : 0} / {questions.length}
            </AppText>
            {palette}
            {questionBody}
          </>
        )}
      </View>
      <ActionSheet
        visible={confirmFinish}
        title="Sınavı bitir"
        onClose={() => setConfirmFinish(false)}
        actions={[
          { key: 'finish', icon: 'checkmark-outline', label: 'Bitir ve kaydet', onPress: submitExam },
        ]}
      />
    </Screen>
  );
}
