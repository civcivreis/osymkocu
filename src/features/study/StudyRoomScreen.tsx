import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { Screen } from '@/src/components/ui/Screen';
import { askConfirm, toastInfo } from '@/src/components/ui/feedbackStore';
import { sortedChoices } from '@/src/features/study/usePractice';
import { useStartExamLobby, useStudyRoom } from '@/src/features/study/useStudyTogether';
import { RoomChat } from '@/src/features/study/RoomChat';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

function rankXp(players: number, rank: number) {
  return Math.max(2, (players - rank + 1) * 2);
}

export function StudyRoomScreen() {
  const { colors, spacing, radius } = useAppTheme();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const id = String(sessionId ?? '');
  const room = useStudyRoom(id || null);
  const kickedAlert = useRef(false);
  const startExam = useStartExamLobby();
  const [now, setNow] = useState(0);
  const state = room.data;
  const questionKey = `${state?.current_index ?? 0}:${state?.question?.id ?? ''}`;
  const [picked, setPicked] = useState<{ key: string; choice: string | null }>({ key: '', choice: null });
  const selected = picked.key === questionKey ? picked.choice : null;
  const me = room.userId;
  const mode = state?.mode ?? 'study';
  const collaborative = mode === 'study' || mode === 'test';
  const competitive = mode === 'race' || mode === 'exam';
  const partner = (state?.members ?? []).find((item) => item.user_id !== me);
  const startsAt = state?.starts_at ? new Date(state.starts_at).getTime() : 0;
  const remaining = state?.status === 'countdown' ? Math.max(0, Math.ceil((startsAt - now) / 1000)) : 0;
  const deadline = state?.question_deadline ? new Date(state.question_deadline).getTime() : 0;
  const questionLeft = state?.status === 'active' && deadline ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  const myAnswer = (state?.answers ?? []).find((item) => item.user_id === me);
  const others = (state?.answers ?? []).filter((item) => item.user_id !== me);
  const question = state?.question;
  const waitingForOthers = Boolean(state?.status === 'active' && myAnswer && others.length < (state.member_count ?? 2) - 1);
  const otherAnswered = others.length > 0 && !myAnswer;

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const message = room.error instanceof Error ? room.error.message : '';
    if (kickedAlert.current || !room.isError || !message.includes('çıkarıldın')) return;
    kickedAlert.current = true;
    toastInfo('Topluluk kuralları nedeniyle bu odadan çıkarıldın.');
    router.back();
  }, [room.error, room.isError]);

  useEffect(() => {
    if (state?.status === 'countdown' && remaining <= 0) {
      void room.refetch();
    }
  }, [remaining, room.refetch, state?.status]);

  useEffect(() => {
    useCoachStore.getState().setCoachLocked(competitive && state?.status !== 'ended' && state?.status !== 'waiting');
    return () => {
      useCoachStore.getState().setCoachLocked(false);
      useCoachStore.getState().setScreenContext(null);
    };
  }, [competitive, state?.status]);

  useEffect(() => {
    if (!collaborative || !question || state?.status !== 'active') {
      useCoachStore.getState().setScreenContext(null);
      return;
    }
    useCoachStore.getState().setScreenContext({
      questionId: question.id,
      questionText: question.stem,
      questionOptions: question.choices,
      selectedAnswer: selected ?? myAnswer?.selected_choice ?? null,
      correctAnswer: myAnswer ? question.correct_choice : undefined,
      explanation: myAnswer ? question.explanation : undefined,
      subject: state.subject_name ?? undefined,
      lessonProgress: `${(state.current_index ?? 0) + 1}/${state.total ?? 0}`,
    });
  }, [collaborative, myAnswer, question, selected, state?.current_index, state?.status, state?.subject_name, state?.total]);

  const onLeave = () => {
    askConfirm({
      title: 'Odadan çık',
      subtitle: 'Karşı taraf da odadan düşer.',
      confirmLabel: 'Çık',
      danger: true,
      onConfirm: () => {
        void room.leave.mutateAsync().finally(() => router.back());
      },
    });
  };

  const memberName = (userId: string) => {
    if (userId === me) return 'Sen';
    return (state?.members ?? []).find((item) => item.user_id === userId)?.display_name ?? 'Öğrenci';
  };

  const title =
    state?.title?.trim() ||
    (mode === 'race'
      ? `${partner?.display_name ?? 'Rakip'} ile ${state?.subject_name ?? 'ders'} yarışması`
      : mode === 'exam'
        ? `${state?.subject_name ?? 'Ders'} sınavı`
        : mode === 'test'
          ? `${state?.subject_name ?? 'Ders'} test odası`
          : `${state?.subject_name ?? 'Ders'} ders odası`);

  return (
    <Screen scroll>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Pressable onPress={onLeave} hitSlop={12} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Ionicons name="chevron-back" size={22} color={colors.accent} />
            <AppText tone="accent">Çık</AppText>
          </Pressable>
          <AppText variant="caption" tone="muted" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
            {state
              ? `${state.subject_name ?? 'Ders'} • ${state.member_count}/${state.capacity} kişi`
              : title}
          </AppText>
        </View>

        {room.isLoading ? <AppText tone="muted">Oda yükleniyor…</AppText> : null}
        {room.isError ? <AppText tone="danger">Oda alınamadı. 0009 SQL çalıştı mı?</AppText> : null}

        {state?.status === 'waiting' ? (
          <Card>
            <View style={{ gap: spacing.sm }}>
              <AppText variant="title">
                {state.subject_name} · {state.member_count}/{state.capacity}
              </AppText>
              <AppText tone="muted">
                Aynı soru herkese aynı anda düşer. Beklerken sohbet edebilirsin.
              </AppText>
              {state.host_id === me && state.member_count >= 2 ? (
                <Button
                  label="Odayı başlat"
                  loading={startExam.isPending}
                  onPress={() => void startExam.mutateAsync(id)}
                />
              ) : (
                <AppText tone="muted">Kurucu başlatınca 10’dan geri sayılır.</AppText>
              )}
            </View>
          </Card>
        ) : null}

        {state?.status === 'countdown' ? (
          <Card>
            <View style={{ alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.lg }}>
              <AppText variant="title">
                {mode === 'race'
                  ? `${partner?.display_name ?? 'Kullanıcı'} ile ${state.subject_name} yarışması başlıyor`
                  : `${state.subject_name} ${mode === 'exam' ? 'sınavı' : 'odası'} başlıyor`}
              </AppText>
              <AppText variant="display">{remaining}</AppText>
            </View>
          </Card>
        ) : null}

        {state?.status === 'ended' ? (
          <Card>
            <View style={{ gap: spacing.sm }}>
              <AppText variant="title">{competitive ? 'Sıralama' : 'Oda bitti'}</AppText>
              {competitive
                ? [...(state.scores ?? [])]
                    .sort((a, b) => b.correct - a.correct)
                    .map((row, index) => (
                      <AppText key={row.user_id}>
                        {index + 1}. {row.user_id === me ? 'Sen' : row.display_name} · {row.correct} doğru · +
                        {rankXp(state.scores.length || state.member_count, index + 1)} XP
                      </AppText>
                    ))
                : (
                  <AppText tone="muted">İstersen Sosyal’den yeniden davet et.</AppText>
                )}
              <Button label="Kapat" onPress={() => router.back()} />
            </View>
          </Card>
        ) : null}

        {question && (state?.status === 'active' || state?.status === 'reveal') ? (
          <View style={{ gap: spacing.sm }}>
            <AppText variant="caption" tone="muted">
              {(state.current_index ?? 0) + 1} / {state.total}
              {mode === 'exam' ? ` · ${questionLeft} sn` : ''}
            </AppText>
            {state.status === 'active' ? (
              <AppText variant="caption" tone={otherAnswered ? 'accent' : 'muted'}>
                {waitingForOthers
                  ? 'Cevabın kilitlendi. Karşı taraf bekleniyor…'
                  : otherAnswered
                    ? 'Karşı taraf cevapladı. Senin cevabın bekleniyor.'
                    : 'Cevap bekleniyor…'}
              </AppText>
            ) : null}
            <AppText variant="title">{question.stem}</AppText>
            {sortedChoices(question.choices).map((choice) => {
              const mine = (selected ?? myAnswer?.selected_choice) === choice.key;
              const reveal = state.status === 'reveal' && collaborative;
              const correct = reveal && question.correct_choice === choice.key;
              const wrongPick = reveal && (state.answers ?? []).some((item) => item.selected_choice === choice.key && item.is_correct === false);
              const partnerPick = (state.answers ?? []).find(
                (item) => item.user_id !== me && item.selected_choice === choice.key,
              );
              return (
                <Pressable
                  key={choice.key}
                  disabled={Boolean(myAnswer) || room.submit.isPending || reveal || (competitive && state.status !== 'active')}
                      onPress={() => setPicked({ key: questionKey, choice: choice.key })}
                  style={{
                    padding: spacing.md,
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: correct
                      ? colors.success
                      : wrongPick
                        ? colors.danger
                        : mine
                          ? colors.accent
                          : colors.border,
                    backgroundColor: correct
                      ? colors.accentMuted
                      : wrongPick
                        ? colors.surfaceMuted
                        : mine
                          ? colors.surfaceMuted
                          : colors.surface,
                  }}>
                  <AppText>
                    {choice.key}) {choice.label}
                    {reveal && partnerPick ? ` · ${memberName(partnerPick.user_id)}` : ''}
                  </AppText>
                </Pressable>
              );
            })}

            {state.status === 'reveal' && collaborative ? (
              <Card>
                <View style={{ gap: spacing.sm }}>
                  <AppText tone="accent">Doğru şık: {question.correct_choice}</AppText>
                  {question.explanation ? <AppText tone="muted">{question.explanation}</AppText> : null}
                  <Button
                    label={(state.current_index ?? 0) + 1 >= state.total ? 'Bitir' : 'Sonraki soru'}
                    loading={room.advance.isPending}
                    onPress={() => void room.advance.mutateAsync()}
                  />
                </View>
              </Card>
            ) : (
              <Button
                label="Cevabı kilitle"
                disabled={!selected || Boolean(myAnswer)}
                loading={room.submit.isPending}
                onPress={() => selected && void room.submit.mutateAsync(selected)}
              />
            )}
          </View>
        ) : null}

        {state && state.status !== 'countdown' && state.chat_enabled !== false && id ? (
          <RoomChat sessionId={id} me={me} members={state.members ?? []} />
        ) : null}
      </View>
    </Screen>
  );
}
