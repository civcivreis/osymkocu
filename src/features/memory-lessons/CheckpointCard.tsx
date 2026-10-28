import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { choiceEntries } from './playerUtils';
import type { MemoryLessonQuestion } from './types';

const MAX_ATTEMPTS = 3;
const CORRECT_LINES = ['Aynen, bu.', 'Tamamdır, devam.', 'Süper, oturdu.', 'Doğru. Devam edelim.'];

export function CheckpointCard({
  question,
  reinforcement,
  onSubmit,
  onContinue,
  submitting,
  overlay = false,
}: {
  question: MemoryLessonQuestion;
  reinforcement?: string | null;
  onSubmit: (answer: string) => Promise<{ correct: boolean; correct_answer: string; explanation?: string | null }>;
  onContinue: (resolved: boolean) => void;
  submitting?: boolean;
  overlay?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [result, setResult] = useState<{ correct: boolean; correct_answer: string; explanation?: string | null } | null>(null);
  const [repeat, setRepeat] = useState(false);

  const prompt = repeat
    ? question.retry_question_text || question.question_text
    : question.question_text || 'Şu az önce neydi?';

  const check = async () => {
    if (!picked || result) return;
    const next = await onSubmit(picked);
    const n = attempts + 1;
    setAttempts(n);
    setResult(next);
  };

  const retrySame = () => {
    setPicked(null);
    setResult(null);
    setRepeat(true);
  };

  const done = result?.correct || attempts >= MAX_ATTEMPTS;
  const coachLine = result?.correct
    ? attempts > 1
      ? 'Aynen. Devam.'
      : question.correct_feedback || CORRECT_LINES[question.question_order % CORRECT_LINES.length]
    : result
      ? attempts >= MAX_ATTEMPTS
        ? question.wrong_feedback || result.explanation || reinforcement || 'Kısa kural bu. Devam ediyoruz.'
        : question.wrong_feedback || result.explanation || reinforcement || ''
      : null;
  const banner = result?.correct
    ? attempts > 1
      ? 'Tamam, oturdu ✓'
      : 'Doğru ✓'
    : result
      ? 'Yanlış'
      : null;

  return (
    <View
      style={{
        position: overlay ? 'absolute' : 'relative',
        left: overlay ? 12 : undefined,
        right: overlay ? 12 : undefined,
        bottom: overlay ? 12 : undefined,
        top: overlay ? 12 : undefined,
        backgroundColor: 'rgba(246,241,232,0.97)',
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 18,
        justifyContent: 'center',
        gap: 12,
      }}>
      <AppText variant="label" tone="accent">
        {repeat ? 'BİR DAHA' : 'KONTROL'}
      </AppText>
      <AppText variant="subtitle">{prompt}</AppText>
      {choiceEntries(question.options).map((choice) => {
        const selected = picked === choice.key;
        const show = Boolean(result);
        const isCorrect = result?.correct_answer === choice.key;
        const isWrongPick = show && selected && !result?.correct;
        return (
          <Pressable
            key={`${choice.key}-${repeat ? 'r' : 'q'}`}
            disabled={Boolean(result) || submitting}
            onPress={() => setPicked(choice.key)}
            style={{
              minHeight: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: isCorrect && show ? colors.success : isWrongPick ? colors.danger : selected ? colors.accent : colors.border,
              backgroundColor: isCorrect && show ? '#ECF8F0' : isWrongPick ? '#FBECEA' : selected ? '#F3E0D4' : colors.surface,
              paddingHorizontal: 12,
              justifyContent: 'center',
            }}>
            <AppText>
              {choice.key}) {choice.label}
            </AppText>
          </Pressable>
        );
      })}
      {!result ? (
        <Pressable
          disabled={!picked || submitting}
          onPress={() => void check()}
          style={{
            minHeight: 48,
            borderRadius: 14,
            backgroundColor: picked ? colors.accent : colors.border,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <AppText tone="inverse">{submitting ? 'Kaydediliyor…' : 'Kontrol Et'}</AppText>
        </Pressable>
      ) : (
        <View style={{ gap: 8 }}>
          <AppText variant="subtitle" style={{ color: result.correct ? colors.success : colors.danger }}>
            {banner}
          </AppText>
          {!result.correct ? <AppText>Doğru cevap: {result.correct_answer}</AppText> : null}
          {coachLine ? <AppText>{coachLine}</AppText> : null}
          {done ? (
            <Pressable
              onPress={() => onContinue(Boolean(result.correct) || attempts >= MAX_ATTEMPTS)}
              style={{
                minHeight: 48,
                borderRadius: 14,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <AppText tone="inverse">{result.correct ? 'Derse Devam Et' : 'Devam et'}</AppText>
            </Pressable>
          ) : (
            <Pressable
              onPress={retrySame}
              style={{
                minHeight: 48,
                borderRadius: 14,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}>
              <AppText tone="inverse">Bir daha soruyorum</AppText>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}
