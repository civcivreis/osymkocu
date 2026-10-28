import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Animated, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { CardGrid } from '@/src/components/ui/CardGrid';
import { OnboardingShell } from '@/src/features/onboarding/OnboardingShell';
import { OnboardingSelectionCard } from '@/src/features/onboarding/OnboardingSelectionCard';
import {
  assessFeasibility,
  formatGoal,
  goalOptions,
} from '@/src/features/onboarding/feasibility';
import { onboardingSchema, type OnboardingValues } from '@/src/features/onboarding/schema';
import { saveOnboarding } from '@/src/features/onboarding/saveOnboarding';
import { useExamSessions, useExams } from '@/src/features/onboarding/useCatalog';
import { nativeDriver } from '@/src/lib/animation/nativeDriver';
import { useReducedMotion } from '@/src/lib/animation/useReducedMotion';
import type { Exam, ExamKind, ExamSession } from '@/src/lib/supabase/types';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import { useAuthStore } from '@/src/stores/authStore';

const TOTAL_STEPS = 5;

export function OnboardingWizard() {
  const examsQuery = useExams();
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [examId, setExamId] = useState<string | null>(null);
  const [targetScore, setTargetScore] = useState<number | null>(null);
  const [examDate, setExamDate] = useState<string | null>(null);
  const [examYear, setExamYear] = useState<number | null>(null);
  const [dailyMinutes, setDailyMinutes] = useState(90);
  const reduced = useReducedMotion();

  const selectedExam = useMemo(
    () => examsQuery.data?.find((exam) => exam.id === examId) ?? null,
    [examId, examsQuery.data],
  );
  const sessionsQuery = useExamSessions(selectedExam);
  const sessions = sessionsQuery.data ?? [];
  const resolvedYear = examYear ?? (sessions.length === 1 ? sessions[0].session_year : null);
  const resolvedDate = examYear != null ? examDate : sessions.length === 1 ? sessions[0].exam_date : examDate;

  const feasibility = useMemo(() => {
    if (!selectedExam || targetScore == null) return null;
    return assessFeasibility({
      kind: selectedExam.kind,
      examDate: resolvedDate,
      examYear: resolvedYear,
      dailyMinutes,
      chosen: targetScore,
    });
  }, [dailyMinutes, resolvedDate, resolvedYear, selectedExam, targetScore]);

  const canContinue = (): boolean => {
    if (step === 1) return Boolean(examId);
    if (step === 2) return resolvedYear != null;
    if (step === 3) return targetScore != null;
    return true;
  };

  const buildValues = (): OnboardingValues => {
    if (!selectedExam || targetScore == null) {
      throw new Error('Sınav seçilmedi');
    }
    return onboardingSchema.parse({
      examId: selectedExam.id,
      examKind: selectedExam.kind,
      targetScore,
      examDate: resolvedDate,
      examYear: resolvedYear ?? 0,
      dailyMinutes,
    });
  };

  const goTo = (next: number, dir: 1 | -1) => {
    setDirection(dir);
    setError(null);
    setStep(next);
  };

  const goNext = async () => {
    if (saving || success) return;
    setError(null);
    if (step < TOTAL_STEPS - 1) {
      goTo(step + 1, 1);
      return;
    }
    setSaving(true);
    try {
      await saveOnboarding(buildValues());
      setSuccess(true);
      const userId = useAuthStore.getState().session?.user.id;
      const wait = reduced ? 0 : 450;
      await new Promise((resolve) => setTimeout(resolve, wait));
      if (userId) {
        try {
          await fetchAuthExtras(userId);
        } catch (refreshError) {
          if (__DEV__) console.warn('[onboarding] profile refresh', refreshError);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Program oluşturulurken bir sorun oluştu. Lütfen tekrar dene.');
    } finally {
      setSaving(false);
    }
  };

  const copy = stepCopy(step, selectedExam?.name);

  return (
    <OnboardingShell
      step={step}
      total={TOTAL_STEPS}
      title={copy.title}
      subtitle={copy.subtitle}
      direction={direction}
      error={error}
      showBack={step > 0}
      primaryLabel={success ? 'Hazır' : step === TOTAL_STEPS - 1 ? 'Programımı oluştur' : 'Devam'}
      loadingLabel="Program oluşturuluyor..."
      primaryLoading={saving}
      primaryDisabled={!canContinue() || success}
      onBack={() => goTo(step - 1, -1)}
      onPrimary={() => void goNext()}>
      {success ? <SuccessMark /> : null}
      {step === 0 ? <WelcomeStep /> : null}
      {step === 1 ? (
        <ExamStep
          exams={examsQuery.data ?? []}
          loading={examsQuery.isLoading}
          error={examsQuery.error ? 'Sınav listesi yüklenemedi. SQL dosyalarını çalıştırdın mı?' : null}
          selectedId={examId}
          onSelect={(id) => {
            setExamId(id);
            setExamDate(null);
            setExamYear(null);
            setTargetScore(null);
          }}
        />
      ) : null}
      {step === 2 ? (
        <DateStep
          kind={selectedExam?.kind}
          examName={selectedExam?.name ?? 'Sınav'}
          sessions={sessionsQuery.data ?? []}
          loading={sessionsQuery.isLoading}
          examYear={resolvedYear}
          onSelect={(session) => {
            setExamYear(session.session_year);
            setExamDate(session.exam_date);
          }}
        />
      ) : null}
      {step === 3 && selectedExam ? (
        <GoalStep
          kind={selectedExam.kind}
          selected={targetScore}
          onSelect={setTargetScore}
          feasibility={feasibility}
        />
      ) : null}
      {step === 4 ? <MinutesStep value={dailyMinutes} onChange={setDailyMinutes} /> : null}
    </OnboardingShell>
  );
}

function stepCopy(step: number, examName?: string) {
  if (step === 0) {
    return { title: 'Koçun hazır.', subtitle: 'Sınavını, hedefini ve günlük süreni söyle. Plan ona göre kurulur.' };
  }
  if (step === 1) {
    return { title: 'Hangi sınava hazırlanıyorsun?', subtitle: 'Kartlardan birini seç. Sonra yıl ve hedefin gelir.' };
  }
  if (step === 2) {
    return {
      title: examName ? `Bir sonraki ${examName}` : 'Hangisine hazırlanıyorsun?',
      subtitle: examName ? `${examName} için oturum yılı.` : undefined,
    };
  }
  if (step === 3) {
    return { title: 'Hedefin ne?', subtitle: 'Kartlardan bir hedef seç. Tempo uygunsa planı ona göre kurarız.' };
  }
  return { title: 'Günde kaç dakika çalışabilirsin?', subtitle: 'Gerçekçi bir tempo seç. Plan buna göre sıkılaşır veya rahatlar.' };
}

function WelcomeStep() {
  const { colors, radius } = useAppTheme();
  const pills = [
    { icon: 'calendar-outline' as const, label: 'Kişisel plan' },
    { icon: 'flag-outline' as const, label: 'Günlük hedef' },
    { icon: 'trending-up-outline' as const, label: 'İlerleme takibi' },
  ];
  return (
    <View style={{ gap: 14, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
      <View
        style={{
          backgroundColor: colors.navy,
          borderRadius: radius[16],
          padding: 22,
          gap: 8,
        }}>
        <AppText style={{ color: '#F4F1EA' }}>TYT, AYT veya KPSS. Aynı hesap telefonda ve web’de.</AppText>
        <AppText variant="caption" style={{ color: '#D7E3F0' }}>
          Sonraki adımlarda sınav, yıl, hedef ve günlük süreyi seçeceksin.
        </AppText>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {pills.map((pill) => (
          <View
            key={pill.label}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingVertical: 8,
              paddingHorizontal: 12,
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surfaceMuted,
            }}>
            <Ionicons name={pill.icon} size={14} color={colors.accent} />
            <AppText variant="caption">{pill.label}</AppText>
          </View>
        ))}
      </View>
    </View>
  );
}

function ExamStep({
  exams,
  loading,
  error,
  selectedId,
  onSelect,
}: {
  exams: Exam[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={{ gap: 12, width: '100%' }}>
      {loading ? <AppText tone="muted">Sınavlar yükleniyor…</AppText> : null}
      {error ? <AppText tone="danger">{error}</AppText> : null}
      <CardGrid gap={12}>
        {exams.map((exam) => (
          <OnboardingSelectionCard
            key={exam.id}
            title={exam.name}
            subtitle={examSubtitle(exam)}
            icon={examIcon(exam.kind, exam.slug)}
            selected={selectedId === exam.id}
            onPress={() => onSelect(exam.id)}
          />
        ))}
      </CardGrid>
    </View>
  );
}

function DateStep({
  examName,
  sessions,
  loading,
  examYear,
  onSelect,
}: {
  kind?: ExamKind;
  examName: string;
  sessions: ExamSession[];
  loading: boolean;
  examYear: number | null;
  onSelect: (session: ExamSession) => void;
}) {
  return (
    <View style={{ gap: 12, width: '100%' }}>
      {loading ? <AppText tone="muted">Oturumlar yükleniyor…</AppText> : null}
      <CardGrid gap={12} singleMaxWidth={420}>
        {sessions.map((session) => (
          <OnboardingSelectionCard
            key={session.id}
            title={String(session.session_year)}
            subtitle={
              session.exam_date
                ? `${examName} · ${session.exam_date}`
                : `${examName}\nÖSYM tarihi henüz yok`
            }
            icon="calendar-outline"
            minHeight={120}
            selected={examYear === session.session_year}
            onPress={() => onSelect(session)}
          />
        ))}
      </CardGrid>
    </View>
  );
}

function MinutesStep({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const options = [45, 60, 90, 120, 180];
  return (
    <CardGrid gap={12}>
      {options.map((option) => (
        <OnboardingSelectionCard
          key={option}
          title={`${option} dk`}
          subtitle={minutesHint(option)}
          icon="time-outline"
          layout="stack"
          minHeight={118}
          selected={value === option}
          onPress={() => onChange(option)}
        />
      ))}
    </CardGrid>
  );
}

function GoalStep({
  kind,
  selected,
  onSelect,
  feasibility,
}: {
  kind: ExamKind;
  selected: number | null;
  onSelect: (value: number) => void;
  feasibility: ReturnType<typeof assessFeasibility> | null;
}) {
  const { colors, radius } = useAppTheme();
  const options = goalOptions(kind);
  const showAlt =
    feasibility && feasibility.status === 'unrealistic' && feasibility.suggested !== feasibility.chosen;

  return (
    <View style={{ gap: 14, width: '100%' }}>
      <CardGrid gap={12}>
        {options.map((option) => (
          <OnboardingSelectionCard
            key={option}
            title={formatGoal(option)}
            subtitle={goalHint(option)}
            icon="flag-outline"
            minHeight={112}
            selected={selected === option}
            onPress={() => onSelect(option)}
          />
        ))}
      </CardGrid>
      {feasibility && selected != null ? (
        <View
          style={{
            width: '100%',
            maxWidth: 480,
            alignSelf: 'center',
            padding: 14,
            borderRadius: radius[16],
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surfaceMuted,
            gap: 10,
          }}>
          <AppText variant="caption">
            {feasibility.status === 'realistic'
              ? `Bu tempoyla ${formatGoal(selected)} hedefi için uygun bir plan oluşturabiliriz.`
              : feasibility.message}
          </AppText>
          {showAlt ? (
            <>
              <Button
                label={`Önerileni al (${formatGoal(feasibility.suggested)})`}
                size="sm"
                onPress={() => onSelect(feasibility.suggested)}
              />
              <AppText tone="muted" variant="caption">
                Devam dersen {formatGoal(feasibility.chosen)} ile gideriz.
              </AppText>
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function SuccessMark() {
  const reduced = useReducedMotion();
  const scale = useRef(new Animated.Value(reduced ? 1 : 0.7)).current;
  const opacity = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const { colors } = useAppTheme();

  useEffect(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: reduced ? 0 : 200, useNativeDriver: nativeDriver }),
      Animated.spring(scale, {
        toValue: 1,
        friction: 7,
        tension: 120,
        useNativeDriver: nativeDriver,
      }),
    ]).start();
  }, [opacity, reduced, scale]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        zIndex: 2,
        opacity,
        transform: [{ scale }],
      }}>
      <Ionicons name="checkmark-circle" size={36} color={colors.success} />
    </Animated.View>
  );
}

function examSubtitle(exam: Exam): string {
  if (exam.slug === 'kpss_ortaogretim') return 'Ortaöğretim GK-GY';
  switch (exam.kind) {
    case 'tyt':
      return 'Üniversite 1. oturum';
    case 'ayt':
      return 'Üniversite 2. oturum';
    case 'tyt_ayt':
      return 'YKS tam hazırlık';
    case 'kpss_onlisans':
      return 'Önlisans GK-GY';
    case 'kpss_lisans':
      return 'Lisans GK-GY';
    default:
      return '';
  }
}

function examIcon(kind: ExamKind, slug?: string): ComponentProps<typeof Ionicons>['name'] {
  if (slug === 'kpss_ortaogretim') return 'book-outline';
  switch (kind) {
    case 'tyt':
      return 'school-outline';
    case 'ayt':
      return 'library-outline';
    case 'tyt_ayt':
      return 'ribbon-outline';
    case 'kpss_onlisans':
      return 'document-text-outline';
    case 'kpss_lisans':
      return 'briefcase-outline';
    default:
      return 'ellipse-outline';
  }
}

function minutesHint(minutes: number): string | undefined {
  if (minutes === 45) return 'Kısa oturum';
  if (minutes === 60) return 'Rahat tempo';
  if (minutes === 90) return 'Dengeli tempo';
  if (minutes === 120) return 'Uzun oturum';
  if (minutes === 180) return 'Yoğun çalışma';
  return undefined;
}

function goalHint(score: number): string {
  if (score === 70 || score === 200) return 'Temel hedef';
  if (score === 80 || score === 300) return 'Güçlü hedef';
  if (score === 90 || score === 400) return 'Yüksek hedef';
  return 'Hedef';
}
