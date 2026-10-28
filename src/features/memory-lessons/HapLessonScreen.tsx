import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { useStudyPresence } from '@/src/features/study/useStudyPresence';
import { APP_NAME } from '@/src/lib/brand';
import { getSupabase } from '@/src/lib/supabase/client';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { useShareAchievement } from '@/src/features/social/useSocial';
import { useStudyRoomMessages } from '@/src/features/study/useStudyTogether';
import { usePairedStudy } from '@/src/features/memory-lessons/usePairedStudy';
import { usePairChatStore } from '@/src/features/study/pairChatStore';

import { LessonChatDock } from './LessonChatDock';
import { LessonVideo } from './LessonVideo';
import {
  cueAsQuestion,
  DEFAULT_NEXT_COUNTDOWN,
  MAX_RETRY,
  optionList,
  parseCuePayload,
  type LessonCue,
} from './lessonFlow';
import {
  autoNextCopy,
  motivationOnCorrect,
  motivationOnOpen,
  motivationOnWrong,
  motivationReadNudge,
  packageProgressCopy,
} from './motivation';
import {
  getLessonCues,
  getNextLessonCountdown,
  getPackageReviewForLesson,
  type PackageReview,
} from './playerApi';
import {
  useCompleteNarration,
  useMemoryLessonPlayerPackage,
  useNextMemoryLesson,
  useStudentLessonMedia,
  useSubmitCheckpoint,
} from './useMemoryLessonPlayer';
import type { MemoryLessonQuestion } from './types';

type HapBlock = { type?: string; title?: string; text?: string };
type Phase = 'hap' | 'watch' | 'question' | 'wrong' | 'success' | 'end' | 'break' | 'pack' | 'pair_wait' | 'pair_hold';

export function HapLessonScreen({
  lessonId,
  examCatalogId,
}: {
  lessonId: string;
  examCatalogId?: string;
}) {
  const { colors, radius, spacing } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const pack = useMemoryLessonPlayerPackage(lessonId);
  const examId = examCatalogId || pack.data?.lesson?.exam_id || undefined;
  const nextLesson = useNextMemoryLesson(lessonId, examId);
  const submit = useSubmitCheckpoint();
  const complete = useCompleteNarration();
  const share = useShareAchievement();
  const [shareOpen, setShareOpen] = useState(false);
  const lesson = pack.data?.lesson;
  const isVideo = lesson?.delivery_mode === 'video' || lesson?.delivery_mode === 'hybrid';
  const media = useStudentLessonMedia(lessonId, Boolean(isVideo && lesson));
  const questions = pack.data?.questions ?? [];
  const mastery = questions[0];
  const [phase, setPhase] = useState<Phase>('hap');
  const [detailOpen, setDetailOpen] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  const [packReview, setPackReview] = useState<PackageReview | null>(null);
  const [packIndex, setPackIndex] = useState(0);
  const [cues, setCues] = useState<LessonCue[]>([]);
  const [activeCue, setActiveCue] = useState<LessonCue | null>(null);
  const fired = useRef(new Set<number>());
  const pairFromPack = useRef(false);
  const postedQuestion = useRef<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [paused, setPaused] = useState(false);
  const [seekMs, setSeekMs] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(DEFAULT_NEXT_COUNTDOWN);
  const [countdownSec, setCountdownSec] = useState(DEFAULT_NEXT_COUNTDOWN);
  const [chatSeed, setChatSeed] = useState<string[]>([motivationOnOpen(1), 'Anlamadığın yeri bana sorabilirsin.']);
  const [waitBonus, setWaitBonus] = useState(0);
  const pairKey =
    phase === 'pack'
      ? packReview?.questions[packIndex]?.id ?? null
      : activeCue
        ? `cue-${activeCue.appear_at_ms}`
        : mastery?.id ?? null;
  const pair = usePairedStudy(
    phase === 'question' || phase === 'pair_wait' || phase === 'pack' || phase === 'pair_hold' || phase === 'wrong'
      ? pairKey
      : null,
  );
  const pairFeed = useStudyRoomMessages(pair.sessionId);
  const goNextRef = useRef<() => void>(() => undefined);
  const markDone = () => {
    void complete.mutateAsync(lessonId).catch(() => undefined);
  };

  useStudyPresence(lesson?.subject_id ?? undefined, Boolean(lesson?.subject_id), lesson?.topic_id ?? null);

  useEffect(() => {
    void getPackageReviewForLesson(lessonId).then(setPackReview).catch(() => setPackReview(null));
    void getLessonCues(lessonId)
      .then((rows) => setCues(rows.map(parseCuePayload)))
      .catch(() => setCues([]));
    void getNextLessonCountdown().then(setCountdownSec).catch(() => setCountdownSec(DEFAULT_NEXT_COUNTDOWN));
    fired.current = new Set();
    setPhase('hap');
    setPicked(null);
    setTries(0);
    setActiveCue(null);
    setPaused(false);
  }, [lessonId]);

  useEffect(() => {
    if (lesson?.delivery_mode === 'video' || lesson?.delivery_mode === 'hybrid') setPhase('watch');
  }, [lesson?.delivery_mode, lessonId]);

  useEffect(() => {
    if (phase !== 'end') return;
    setSecondsLeft(countdownSec);
    const tick = setInterval(() => {
      setSecondsLeft((value) => {
        if (value <= 1) {
          clearInterval(tick);
          goNextRef.current();
          return 0;
        }
        return value - 1;
      });
    }, 1000);
    return () => clearInterval(tick);
  }, [phase, countdownSec]);

  useEffect(() => {
    if (seekMs == null) return;
    const timer = setTimeout(() => setSeekMs(null), 80);
    return () => clearTimeout(timer);
  }, [seekMs]);

  const blocks = useMemo(() => {
    const raw = lesson?.hap_blocks;
    if (Array.isArray(raw) && raw.length) return raw as HapBlock[];
    const fallback: HapBlock[] = [];
    if (lesson?.minimum_theory) fallback.push({ type: 'HAP_BILGI', title: 'Hap bilgi', text: lesson.minimum_theory });
    if (lesson?.fast_rule) fallback.push({ type: 'HIZLI_TEKNIK', title: 'Taktik', text: lesson.fast_rule });
    const trap = lesson?.exam_technique?.common_traps;
    if (typeof trap === 'string' && trap.trim()) fallback.push({ type: 'TUZAK', title: 'Hafıza ipucu', text: trap });
    return fallback;
  }, [lesson]);

  const detailed = String(lesson?.detailed_explanation ?? '');
  const videoUrl = media.data ? Object.values(media.data).find((url) => /\.(mp4|webm|mov)(\?|$)/i.test(url) || url.includes('video')) ?? Object.values(media.data)[0] : null;

  const goNext = () => {
    markDone();
    if (pair.paired) {
      void pair.postEvent.mutateAsync({ event: 'next_topic', body: 'Bir sonraki konuya geçiliyor.' });
    }
    const nxt = nextLesson.data;
    if (nxt?.lesson_id) {
      router.replace({
        pathname: '/dersler/hafiza/[lessonId]',
        params: { lessonId: nxt.lesson_id, examCatalogId: examId ?? examCatalogId ?? '' },
      });
      return;
    }
    router.replace('/dersler/hafiza' as never);
  };

  useEffect(() => {
    goNextRef.current = goNext;
  });

  const openEnd = () => {
    if (pair.paired) {
      void pair.postEvent.mutateAsync({ event: 'topic_done', body: 'Konu tamamlandı.' });
    }
    setChatSeed((prev) => [...prev, autoNextCopy()]);
    if (packReview?.isLast && packReview.questions.length) {
      setPhase('pack');
      setPackIndex(0);
      setPicked(null);
      setChatSeed((prev) => [...prev, 'Paket tamamlandı 🎯', packageProgressCopy(packReview.position, packReview.total)]);
      return;
    }
    setPhase('end');
  };

  const resumeVideo = () => {
    const resumeAt = activeCue?.resume_ms || activeCue?.appear_at_ms || 0;
    setPaused(false);
    setSeekMs(resumeAt);
    setActiveCue(null);
    setPicked(null);
    setTries(0);
    setPhase('watch');
  };

  const finishMastery = (then: 'end' | 'resume' = 'end') => {
    if (then === 'resume' && isVideo) {
      resumeVideo();
      return;
    }
    markDone();
    if (packReview && packReview.total > 1 && !packReview.isLast) {
      setChatSeed((prev) => [...prev, packageProgressCopy(packReview.position, packReview.total)]);
    }
    openEnd();
  };

  const activeQuestion: MemoryLessonQuestion | undefined =
    phase === 'pack' ? packReview?.questions[packIndex] : activeCue ? cueAsQuestion(activeCue, lessonId) : mastery;
  const options = activeQuestion ? optionList(activeQuestion) : [];
  const correct = activeQuestion?.correct_answer;

  const onPick = (key: string) => {
    if (!activeQuestion || phase === 'end' || phase === 'break' || phase === 'pair_wait' || phase === 'pair_hold') return;
    if (picked && pair.paired) return;
    setPicked(key);
    const ok = key === correct;
    if (phase !== 'pack' && !String(activeQuestion.id).startsWith('cue-')) {
      void submit.mutateAsync({ lessonId, questionId: activeQuestion.id, answer: key }).catch(() => undefined);
    }
    if (pair.paired && pair.sessionId && !pair.state?.revealed && (phase === 'question' || phase === 'pack')) {
      pairFromPack.current = phase === 'pack';
      void pair.submit.mutateAsync({ questionKey: String(activeQuestion.id), choice: key, correct: ok });
      setPhase('pair_wait');
      setWaitBonus(0);
      return;
    }
    if (ok && pair.paired && pair.state?.revealed) {
      void pair.postEvent.mutateAsync({ event: 'pair_ready', body: 'Tamamdır ✓ İkiniz de hazırsınız.' });
    }
    if (ok) {
      setChatSeed((prev) => [...prev, motivationOnCorrect(tries + 1)]);
      if (phase === 'pack') {
        const nextIndex = packIndex + 1;
        if (nextIndex >= (packReview?.questions.length ?? 0)) {
          markDone();
          setPhase('end');
          setChatSeed((prev) => [...prev, autoNextCopy()]);
          return;
        }
        setPackIndex(nextIndex);
        setPicked(null);
        return;
      }
      const action = activeCue?.onCorrect ?? (isVideo ? 'resume' : 'next');
      setPhase('success');
      setTimeout(() => finishMastery(action === 'resume' && isVideo ? 'resume' : 'end'), 700);
      return;
    }
    const nextTries = tries + 1;
    setTries(nextTries);
    setChatSeed((prev) => [...prev, motivationOnWrong(nextTries)]);
    if (nextTries >= MAX_RETRY && phase !== 'pack') {
      finishMastery(activeCue?.onCorrect === 'resume' && isVideo ? 'resume' : 'end');
      return;
    }
    const wrongMode = activeCue?.onWrong ?? 'show_detail_then_retry';
    if (wrongMode === 'retry') {
      setPicked(null);
      return;
    }
    if (activeCue && activeCue.retryRequired === false) {
      setPhase('wrong');
      setDetailOpen(true);
      return;
    }
    setPhase(phase === 'pack' ? 'pack' : 'wrong');
    setDetailOpen(true);
  };

  const wrongSource = String(activeQuestion?.wrong_feedback ?? 'detail');
  const hapText = blocks.find((block) => String(block.type ?? '').includes('HAP'))?.text ?? lesson?.minimum_theory ?? '';
  const wrongBody =
    wrongSource === 'hap'
      ? String(hapText || detailed || '')
      : wrongSource === 'custom'
        ? String(activeQuestion?.explanation ?? detailed ?? '')
        : activeCue?.explanation || detailed || String(activeQuestion?.explanation ?? '');
  const correctOption = options.find((opt) => opt.key === correct);

  useEffect(() => {
    if (phase !== 'pair_wait') return;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [phase]);

  useEffect(() => {
    if (phase !== 'pair_wait' || !pair.state?.revealed) return;
    if (pair.state.mine_correct) {
      if (pair.state.both_correct) {
        setPhase('success');
        if (pairFromPack.current) {
          const nextIndex = packIndex + 1;
          if (nextIndex >= (packReview?.questions.length ?? 0)) {
            markDone();
            setPhase('end');
            return;
          }
          setPackIndex(nextIndex);
          setPicked(null);
          setPhase('pack');
          return;
        }
        const action = activeCue?.onCorrect ?? (isVideo ? 'resume' : 'next');
        const timer = setTimeout(() => finishMastery(action === 'resume' && isVideo ? 'resume' : 'end'), 700);
        return () => clearTimeout(timer);
      }
      setPhase('pair_hold');
      return;
    }
    setPhase('wrong');
    setDetailOpen(true);
  }, [phase, pair.state?.revealed, pair.state?.mine_correct, pair.state?.both_correct]);

  useEffect(() => {
    if (!pair.paired || !pairKey) return;
    if (phase !== 'question' && phase !== 'pack') return;
    const stamp = `${pair.sessionId}:${pairKey}`;
    if (postedQuestion.current === stamp) return;
    postedQuestion.current = stamp;
    void pair.postEvent.mutateAsync({ event: 'question_open', body: 'Yeni soru hazır.', metadata: { question_key: pairKey } });
  }, [phase, pairKey, pair.paired, pair.sessionId, pair.postEvent]);

  useEffect(() => {
    if (pair.partner?.presence === 'left') usePairChatStore.getState().markSolo();
  }, [pair.partner?.presence]);

  useEffect(() => {
    if (phase !== 'pair_hold') return;
    const ready = (pairFeed.data ?? []).some((row) => row.event_type === 'pair_ready');
    if (!ready) return;
    setPhase('success');
    const action = activeCue?.onCorrect ?? (isVideo ? 'resume' : 'next');
    finishMastery(action === 'resume' && isVideo ? 'resume' : 'end');
  }, [phase, pairFeed.data]);

  const understood = () => {
    setDetailOpen(false);
    setPicked(null);
    if (phase === 'hap') {
      if (!mastery) {
        finishMastery();
        return;
      }
      setPhase('question');
      return;
    }
    if (phase === 'wrong') {
      if (activeCue && activeCue.retryRequired === false) {
        finishMastery(activeCue.onCorrect === 'resume' && isVideo ? 'resume' : 'end');
        return;
      }
      setPhase('question');
    }
  };

  const onVideoTime = (ms: number) => {
    if (phase !== 'watch' || paused) return;
    const hit = cues.find(
      (cue) =>
        !fired.current.has(cue.appear_at_ms) &&
        ms >= cue.appear_at_ms &&
        (cue.questionText || cue.event_type === 'question' || cue.event_type === 'pause'),
    );
    if (!hit) return;
    fired.current.add(hit.appear_at_ms);
    setPaused(true);
    if (hit.questionText || hit.event_type === 'question') {
      setActiveCue(hit);
      setPicked(null);
      setTries(0);
      setPhase('question');
      return;
    }
  };

  if (pack.isLoading || !lesson) {
    return (
      <Screen>
        <AppText>{pack.isError ? 'Ders alınamadı.' : 'Yükleniyor…'}</AppText>
      </Screen>
    );
  }

  const showQuestion =
    phase === 'question' || phase === 'wrong' || phase === 'success' || phase === 'pack' || phase === 'pair_wait' || phase === 'pair_hold';
  const waitMs = (pair.state?.wait_seconds ?? pair.waitSeconds) * 1000 + waitBonus;
  const submittedAt = pair.state?.submitted_at ? Date.parse(pair.state.submitted_at) : 0;
  const waitingTooLong = phase === 'pair_wait' && pair.state?.waiting && submittedAt > 0 && now - submittedAt > waitMs;

  return (
    <Screen scroll={false} style={isDesktop ? { maxWidth: 1100, paddingBottom: 8 } : { paddingBottom: 8 }}>
      <SeoHead title={`${lesson.title} | ${APP_NAME}`} path={`/dersler/hafiza/${lessonId}`} index={false} />
      <View style={{ flex: 1, gap: spacing.md, paddingBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable
            onPress={() => {
              if (pair.paired) void pair.leave.mutateAsync();
              router.back();
            }}
            hitSlop={8}>
            <Ionicons name="chevron-back" size={20} color={colors.accent} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <AppText variant="subtitle">{lesson.title}</AppText>
            <AppText variant="caption" tone="muted">
              {lesson.subject} · {lesson.topic}
            </AppText>
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 10, paddingBottom: 8 }}>
          {isVideo && videoUrl && phase !== 'pack' && phase !== 'end' && phase !== 'break' ? (
            <LessonVideo
              uri={videoUrl}
              paused={paused || phase === 'question' || phase === 'wrong' || phase === 'pair_wait' || phase === 'pair_hold'}
              seekMs={seekMs}
              onTimeMs={onVideoTime}
              onEnded={() => {
                if (cues.length) {
                  finishMastery();
                  return;
                }
                if (mastery && !fired.current.has(-1)) {
                  fired.current.add(-1);
                  setPaused(true);
                  setActiveCue(null);
                  setPhase('question');
                  return;
                }
                finishMastery();
              }}
            />
          ) : null}

          {phase !== 'pack' && phase !== 'end' && phase !== 'break'
            ? blocks.map((block, index) => (
                <View
                  key={`${block.type}-${index}`}
                  style={{
                    padding: 14,
                    borderRadius: radius.lg,
                    backgroundColor: colors.surface,
                    borderWidth: 1,
                    borderColor: colors.border,
                    gap: 4,
                  }}>
                  <AppText variant="label">{block.title || 'Hap bilgi'}</AppText>
                  <AppText>{block.text}</AppText>
                </View>
              ))
            : null}

          {phase === 'success' ? (
            <View style={{ padding: 14, borderRadius: 12, backgroundColor: '#E8F3E8' }}>
              <AppText>Harika, doğru bildin ✓</AppText>
            </View>
          ) : null}

          {phase === 'hap' && !isVideo ? (
            <Pressable
              onPress={() => {
                setChatSeed((prev) => [...prev, motivationReadNudge(2)]);
                if (!mastery) {
                  finishMastery();
                  return;
                }
                setPhase('question');
              }}
              style={{
                alignSelf: 'flex-start',
                backgroundColor: '#C45C26',
                borderRadius: 12,
                paddingHorizontal: 14,
                minHeight: 44,
                justifyContent: 'center',
              }}>
              <AppText tone="inverse">Anladım</AppText>
            </Pressable>
          ) : null}

          {showQuestion && activeQuestion ? (
            <View style={{ gap: 8 }}>
              {phase === 'pack' ? (
                <>
                  {packIndex === 0 ? <AppText variant="title">Paket tamamlandı 🎯</AppText> : null}
                  <AppText variant="label">
                    Paket tekrarı {packIndex + 1}/{packReview?.questions.length ?? 0}
                  </AppText>
                </>
              ) : null}
              <AppText variant="label">{activeQuestion.question_text}</AppText>
              {options.map((opt) => {
                const wrongPick = picked === opt.key && opt.key !== correct;
                const reveal = Boolean(picked) && (phase === 'wrong' || phase === 'success' || (phase === 'pack' && !pair.paired));
                const showCorrect = reveal && opt.key === correct;
                return (
                  <Pressable
                    key={opt.key}
                    disabled={Boolean(picked) || phase === 'pair_wait' || phase === 'pair_hold'}
                    onPress={() => onPick(opt.key)}
                    style={{
                      padding: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: showCorrect || (reveal && opt.key === correct) ? '#2F7D32' : wrongPick && reveal ? '#C62828' : picked === opt.key ? '#C45C26' : colors.border,
                      backgroundColor: showCorrect || (reveal && opt.key === correct) ? '#E8F3E8' : wrongPick && reveal ? '#FCE8E4' : picked === opt.key ? '#F3E0D4' : '#fff',
                    }}>
                    <AppText>
                      {opt.key}) {opt.text}
                    </AppText>
                  </Pressable>
                );
              })}
              {phase === 'pair_wait' ? (
                <AppText variant="caption" tone="muted">
                  Cevabın kilitlendi. Arkadaşın bekleniyor...
                </AppText>
              ) : null}
              {phase === 'pair_hold' ? (
                <AppText variant="caption" tone="muted">
                  Arkadaşın kısa tekrar yapıyor. Birazdan birlikte devam edeceksiniz.
                </AppText>
              ) : null}
              {waitingTooLong ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <Pressable onPress={() => setWaitBonus((value) => value + 30000)} style={{ paddingHorizontal: 12, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}>
                    <AppText>Biraz Daha Bekle</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      usePairChatStore.getState().markSolo();
                      const ok = picked === correct;
                      if (ok) {
                        setPhase('success');
                        const action = activeCue?.onCorrect ?? (isVideo ? 'resume' : 'next');
                        finishMastery(action === 'resume' && isVideo ? 'resume' : 'end');
                      } else {
                        setPhase('wrong');
                        setDetailOpen(true);
                      }
                    }}
                    style={{ paddingHorizontal: 12, minHeight: 40, borderRadius: 12, backgroundColor: '#C45C26', justifyContent: 'center' }}>
                    <AppText tone="inverse">Tek Başına Devam Et</AppText>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ) : null}

          {phase === 'end' ? (
            <View style={{ padding: 18, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
              <AppText variant="title">Sıradaki derse geçiliyor</AppText>
              <AppText variant="subtitle">{secondsLeft}</AppText>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                <Pressable
                  onPress={() => {
                    markDone();
                    setPhase('break');
                    void pair.postEvent.mutateAsync({ event: 'break_start', body: 'Mola verdi ☕' });
                    if (pair.sessionId) void getSupabase().rpc('heartbeat_pair_session', { p_session: pair.sessionId, p_presence: 'break' });
                  }}
                  style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}>
                  <AppText>Mola Ver</AppText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    markDone();
                    if (pair.paired) void pair.leave.mutateAsync();
                    router.replace('/home' as never);
                  }}
                  style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}>
                  <AppText>Bitir</AppText>
                </Pressable>
                <Pressable onPress={goNext} style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 12, backgroundColor: '#C45C26', justifyContent: 'center' }}>
                  <AppText tone="inverse">Geç</AppText>
                </Pressable>
                <Pressable
                  onPress={() => setShareOpen(true)}
                  style={{ paddingHorizontal: 14, minHeight: 40, borderRadius: 12, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }}>
                  <AppText>Sosyal'de Paylaş</AppText>
                </Pressable>
              </View>
            </View>
          ) : null}

          {phase === 'break' ? (
            <View style={{ padding: 18, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: 12 }}>
              <AppText variant="title">Moladasın ☕</AppText>
              <Pressable
                onPress={() => {
                  void pair.postEvent.mutateAsync({ event: 'break_end', body: 'Geri döndü.' });
                  goNext();
                }}
                style={{ alignSelf: 'flex-start', paddingHorizontal: 14, minHeight: 44, borderRadius: 12, backgroundColor: '#C45C26', justifyContent: 'center' }}>
                <AppText tone="inverse">Devam Et</AppText>
              </Pressable>
            </View>
          ) : null}
        </ScrollView>

        <LessonChatDock lessonId={lessonId} seed={chatSeed} />
      </View>

      <Modal visible={shareOpen} animationType="fade" transparent onRequestClose={() => setShareOpen(false)}>
        <Pressable
          onPress={() => setShareOpen(false)}
          style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'center', padding: 24 }}>
          <Pressable
            onPress={() => undefined}
            style={{ backgroundColor: '#FFFCF7', borderRadius: 16, padding: 20, gap: 10 }}>
            <AppText variant="subtitle">{lesson?.topic || lesson?.title || 'Konu'} tamamlandı 🎯</AppText>
            <AppText variant="caption" tone="muted">
              {lesson?.subject ? `${lesson.subject}` : 'Ders'} · yalnızca sen paylaşırsan Sosyal'de görünür.
            </AppText>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <Pressable
                onPress={() => setShareOpen(false)}
                style={{ flex: 1, minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' }}>
                <AppText>Vazgeç</AppText>
              </Pressable>
              <Pressable
                onPress={() => {
                  void share
                    .mutateAsync({
                      title: `${lesson?.topic || lesson?.title || 'Konu'} tamamlandı 🎯`,
                      body: lesson?.subject ? `${lesson.subject}` : null,
                      subjectId: lesson?.subject_id ?? null,
                      topicId: lesson?.topic_id ?? null,
                    })
                    .then(
                      () => {
                        toastSuccess("Sosyal'de paylaşıldı.");
                        setShareOpen(false);
                      },
                      (error: unknown) => toastError(error),
                    );
                }}
                style={{ flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: '#C45C26', alignItems: 'center', justifyContent: 'center' }}>
                <AppText tone="inverse">Paylaş</AppText>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={detailOpen} animationType="slide" transparent>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.45)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: '#FFFCF7', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 12, maxHeight: '80%' }}>
            {phase === 'wrong' ? (
              <>
                <AppText variant="subtitle">Doğru yanıt {correctOption ? `${correctOption.key}) ${correctOption.text}` : correct}</AppText>
                <AppText>{wrongBody || 'Kısa tekrar: hap bilgiye ve detaya tekrar bak.'}</AppText>
              </>
            ) : (
              <>
                <AppText variant="subtitle">Detaylı anlatım</AppText>
                <AppText>{detailed || 'Bu konu için ek anlatım henüz eklenmedi.'}</AppText>
              </>
            )}
            <Pressable
              onPress={understood}
              style={{ backgroundColor: '#C45C26', borderRadius: 12, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <AppText tone="inverse">Anladım</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
