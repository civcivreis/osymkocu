import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { Screen } from '@/src/components/ui/Screen';
import { ChatImageViewer } from '@/src/features/social/ChatImage';
import { QuestionPalette } from '@/src/features/study/QuestionPalette';
import { sortedChoices, useCompletePracticeSet, usePracticeQuestions, useSubmitAttempt } from '@/src/features/study/usePractice';
import { useStudyPresence } from '@/src/features/study/useStudyPresence';
import { usePairChatStore } from '@/src/features/study/pairChatStore';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import type { AttemptResult } from '@/src/lib/supabase/types';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export default function PracticeScreen() {
  const { colors, spacing, radius } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const pairOpen = usePairChatStore((s) => Boolean(s.session?.expanded));
  const params = useLocalSearchParams<{ subjectId?: string; mode?: string }>();
  const review = params.mode === 'review';
  const mixed = params.mode === 'mixed';
  const autoMatch = useAuthStore((s) => s.profile?.auto_match) !== false;
  const questionsQuery = usePracticeQuestions({ subjectId: params.subjectId, review, mixed });
  const submit = useSubmitAttempt();
  const completeSet = useCompletePracticeSet();
  const questions = questionsQuery.data ?? [];
  const [index, setIndex] = useState(0);
  useStudyPresence(
    params.subjectId,
    Boolean(params.subjectId) && !review && autoMatch,
    questions[index]?.topic_id,
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [correctCount, setCorrectCount] = useState(0);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [finished, setFinished] = useState(false);
  const [marked, setMarked] = useState<Record<string, boolean>>({});
  const [answered, setAnswered] = useState<Record<string, boolean>>({});
  const [elapsed, setElapsed] = useState(0);
  const [imageOpen, setImageOpen] = useState(false);
  const setId = useRef(crypto.randomUUID());
  const awarded = useRef(false);

  const question = questions[index];

  useEffect(() => {
    const tick = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    if (questions.length > 0) {
      AnalyticsProvider.track('test_started', { review, mixed });
    }
  }, [mixed, questions.length, review]);

  useEffect(() => {
    if (!question || finished) {
      useCoachStore.getState().setScreenContext(null);
      return;
    }
    useCoachStore.getState().setScreenContext({
      questionId: question.id,
      questionText: question.stem,
      questionOptions: question.choices,
      selectedAnswer: selected,
      correctAnswer: result?.correct_choice,
      explanation: result?.explanation,
      examType: question.exam_slug,
      subject: question.subject_name,
      topic: question.topic_name,
      imageUrl: question.image_url,
    });
  }, [finished, question, result, selected]);

  useEffect(() => {
    return () => {
      useCoachStore.getState().setScreenContext(null);
    };
  }, []);

  useEffect(() => {
    setIndex(0);
    setSelected(null);
    setResult(null);
    setCorrectCount(0);
    setFinished(false);
    setStartedAt(Date.now());
    setId.current = crypto.randomUUID();
    awarded.current = false;
  }, [questionsQuery.dataUpdatedAt]);

  useEffect(() => {
    if (!finished || awarded.current || questions.length === 0) return;
    awarded.current = true;
    void completeSet.mutateAsync({
      setId: setId.current,
      questionIds: questions.map((item) => item.id),
    }).catch(() => undefined);
  }, [completeSet, finished, questions]);

  const onSubmit = async () => {
    if (!question || !selected) return;
    try {
      const next = await submit.mutateAsync({
        questionId: question.id,
        choice: selected,
        timeSpentMs: Date.now() - startedAt,
        mode: review ? 'review' : 'practice',
      });
      setResult(next);
      setAnswered((current) => ({ ...current, [question.id]: true }));
      if (next.is_correct) setCorrectCount((value) => value + 1);
    } catch (error) {
      setResult({
        is_correct: false,
        correct_choice: '',
        explanation: error instanceof Error ? error.message : 'Cevap kaydedilemedi',
        xp_awarded: 0,
        difficulty: question.difficulty,
      });
    }
  };

  const goNext = () => {
    if (index + 1 >= questions.length) {
      setFinished(true);
      return;
    }
    setIndex((value) => value + 1);
    setSelected(null);
    setResult(null);
    setStartedAt(Date.now());
  };

  const questionBody = question ? (
    <>
      {question.image_url ? (
        <RemoteImage
          uri={question.image_url}
          accessibilityLabel="Soru görseli"
          resizeMode="contain"
          style={{ width: '100%', height: 240, borderRadius: 12 }}
          onPress={() => setImageOpen(true)}
        />
      ) : null}
      <AppText variant="title">{question.stem}</AppText>
      <View style={{ gap: spacing.sm }}>
        {sortedChoices(question.choices).map((choice) => {
          const isSelected = selected === choice.key;
          const showAnswer = Boolean(result);
          const isCorrectChoice = result?.correct_choice === choice.key;
          const isWrongPick = showAnswer && isSelected && !result?.is_correct;
          return (
            <Pressable
              key={choice.key}
              disabled={Boolean(result) || submit.isPending}
              onPress={() => setSelected(choice.key)}
              style={{
                padding: spacing.md,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: isCorrectChoice
                  ? colors.success
                  : isWrongPick
                    ? colors.danger
                    : isSelected
                      ? colors.accent
                      : colors.border,
                backgroundColor: isCorrectChoice
                  ? colors.accentMuted
                  : isSelected
                    ? colors.surfaceMuted
                    : colors.surface,
              }}>
              <AppText>
                {choice.key}) {choice.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {result ? (
        <Card>
          <View style={{ gap: spacing.sm }}>
            <AppText tone={result.is_correct ? 'accent' : 'danger'}>
              {result.is_correct ? 'Doğru' : `Yanlış. Doğru cevap ${result.correct_choice}`}
            </AppText>
            <AppText tone="muted">{result.explanation}</AppText>
            <Button label={index + 1 >= questions.length ? 'Bitir' : 'Sonraki'} onPress={goNext} />
          </View>
        </Card>
      ) : (
        <Button
          label="Cevabı kilitle"
          disabled={!selected}
          loading={submit.isPending}
          onPress={() => void onSubmit()}
        />
      )}
    </>
  ) : null;

  const palette = (
    <QuestionPalette
      current={index}
      onSelect={(next) => {
        setIndex(next);
        setSelected(null);
        setResult(null);
      }}
      items={questions.map((item) => ({
        id: item.id,
        answered: Boolean(answered[item.id]),
        marked: Boolean(marked[item.id]),
      }))}
    />
  );

  const sideInfo = question ? (
    <View style={{ gap: 12 }}>
      <AppText variant="label">
        {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}
      </AppText>
      <AppText variant="caption" tone="muted">
        {question.subject_name}
        {question.topic_name ? ` • ${question.topic_name}` : ''}
      </AppText>
      <AppText variant="caption">
        Cevaplanan {Object.keys(answered).length} / {questions.length}
      </AppText>
      <Pressable
        onPress={() =>
          setMarked((current) => ({ ...current, [question.id]: !current[question.id] }))
        }>
        <AppText tone="accent">{marked[question.id] ? 'İşareti kaldır' : 'Gözden geçir'}</AppText>
      </Pressable>
      <Button label="Bitir" variant="secondary" onPress={() => setFinished(true)} />
      <Pressable onPress={() => useCoachStore.getState().setOpen(true)}>
        <AppText variant="label" tone="accent">
          Koça sor
        </AppText>
      </Pressable>
    </View>
  ) : null;

  return (
    <Screen scroll={!isDesktop} style={isDesktop && pairOpen ? { paddingRight: 12 } : undefined}>
      <View style={{ gap: spacing.lg, flex: 1, paddingRight: isDesktop && pairOpen ? 340 : 0 }}>
        <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="chevron-back" size={20} color={colors.accent} />
          <AppText tone="accent">Geri</AppText>
        </Pressable>

        {questionsQuery.isLoading ? (
          <AppText tone="muted">Sorular yükleniyor…</AppText>
        ) : questionsQuery.isError ? (
          <AppText tone="danger">
            Soru bankası okunamadı. supabase/migrations/0003_practice.sql dosyasını SQL Editor’da çalıştır.
          </AppText>
        ) : questions.length === 0 ? (
          <Card>
            <AppText variant="subtitle">Soru yok</AppText>
            <AppText tone="muted">
              {review
                ? 'Yanlış defterin boş. Önce pratik yap.'
                : mixed
                  ? 'Karışık test için henüz yeterli soru yok.'
                  : 'Bu derse henüz soru eklenmemiş. 0003 SQL’ini çalıştırman gerekebilir.'}
            </AppText>
          </Card>
        ) : finished ? (
          <Card>
            <View style={{ gap: spacing.sm }}>
              <AppText variant="title">Set bitti</AppText>
              <AppText>
                {correctCount} / {questions.length} doğru
              </AppText>
              <Button label="Çalışmaya dön" onPress={() => router.back()} />
            </View>
          </Card>
        ) : isDesktop && question ? (
          <View style={{ flexDirection: 'row', alignItems: 'stretch', gap: 16, flex: 1, minHeight: 0 }}>
            <View style={{ width: 160, minHeight: 0 }}>
              <ScrollView style={{ flex: 1 }}>{palette}</ScrollView>
            </View>
            <ScrollView style={{ flex: 1, minWidth: 0 }} contentContainerStyle={{ gap: 12, paddingBottom: 32 }}>
              {questionBody}
            </ScrollView>
            <View style={{ width: 220 }}>{sideInfo}</View>
          </View>
        ) : question ? (
          <>
            <AppText variant="caption" tone="muted">
              {index + 1} / {questions.length}
            </AppText>
            {questionBody}
          </>
        ) : null}
      </View>
      <ChatImageViewer
        visible={imageOpen}
        uri={question?.image_url ?? null}
        caption={question?.stem}
        onClose={() => setImageOpen(false)}
      />
    </Screen>
  );
}
