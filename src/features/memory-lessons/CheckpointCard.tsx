import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { choiceEntries } from './playerUtils';
import type { MemoryLessonQuestion } from './types';

export function CheckpointCard({
  question,
  reinforcement,
  onSubmit,
  onContinue,
  submitting,
}: {
  question: MemoryLessonQuestion;
  reinforcement?: string | null;
  onSubmit: (answer: string) => Promise<{ correct: boolean; correct_answer: string; explanation?: string | null }>;
  onContinue: () => void;
  submitting?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const [picked, setPicked] = useState<string | null>(null);
  const [result, setResult] = useState<{ correct: boolean; correct_answer: string; explanation?: string | null } | null>(null);

  const check = async () => {
    if (!picked || result) return;
    const next = await onSubmit(picked);
    setResult(next);
  };

  return (
    <View
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        bottom: 12,
        top: 12,
        backgroundColor: 'rgba(246,241,232,0.97)',
        borderRadius: radius.xl,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 18,
        justifyContent: 'center',
        gap: 12,
      }}>
      <AppText variant="label" tone="accent">
        HIZLI HATIRLA
      </AppText>
      <AppText variant="subtitle">{question.question_text}</AppText>
      {choiceEntries(question.options).map((choice) => {
        const selected = picked === choice.key;
        const show = Boolean(result);
        const isCorrect = result?.correct_answer === choice.key;
        return (
          <Pressable
            key={choice.key}
            disabled={Boolean(result) || submitting}
            onPress={() => setPicked(choice.key)}
            style={{
              minHeight: 44,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: isCorrect ? colors.success : selected ? colors.accent : colors.border,
              backgroundColor: isCorrect ? '#ECF8F0' : selected ? '#F3E0D4' : colors.surface,
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
            {result.correct ? 'Doğru ✓' : `Doğru cevap: ${result.correct_answer}`}
          </AppText>
          <AppText>
            {result.explanation || reinforcement || (result.correct ? 'Bu çıpayı aklında tut.' : 'Sahneyi tekrar hatırla.')}
          </AppText>
          <Pressable
            onPress={onContinue}
            style={{
              minHeight: 48,
              borderRadius: 14,
              backgroundColor: colors.accent,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <AppText tone="inverse">Derse Devam Et</AppText>
          </Pressable>
        </View>
      )}
    </View>
  );
}
