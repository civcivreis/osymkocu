import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { Animated, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import {
  OnboardingShell,
  onboardingCardWidth,
} from '@/src/features/onboarding/OnboardingShell';
import { OnboardingSelectionCard } from '@/src/features/onboarding/OnboardingSelectionCard';
import {
  assessFeasibility,
  formatGoal,
  goalOptions,
} from '@/src/features/onboarding/feasibility';
import { onboardingSchema, type OnboardingValues } from '@/src/features/onboarding/schema';
import { saveOnboarding } from '@/src/features/onboarding/saveOnboarding';
import { useExamSessions, useExams, useSubjects } from '@/src/features/onboarding/useCatalog';
import { nativeDriver } from '@/src/lib/animation/nativeDriver';
import { useReducedMotion } from '@/src/lib/animation/useReducedMotion';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import type { Exam, ExamKind, ExamSession } from '@/src/lib/supabase/types';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { fetchAuthExtras } from '@/src/features/auth/useAuth';
import { useAuthStore } from '@/src/stores/authStore';

const TOTAL_STEPS = 6;

function toggleExclusive(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

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
  const [strongSubjectIds, setStrongSubjectIds] = useState<string[]>([]);
  const [weakSubjectIds, setWeakSubjectIds] = useState<string[]>([]);
  const reduced = useReducedMotion();

  const selectedExam = useMemo(
    () => examsQuery.data?.find((exam) => exam.id === examId) ?? null,
    [examId, examsQuery.data],
  );
  const subjectsQuery = useSubjects(selectedExam);
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
    if (step === 4) return targetScore != null;
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
      strongSubjectIds,
      weakSubjectIds,
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

  const copy = stepCopy(step, selectedExam?.kind, selectedExam?.name, feasibility?.status === 'unrealistic');

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
      {step === 3 ? <MinutesStep value={dailyMinutes} onChange={setDailyMinutes} /> : null}
      {step === 4 && selectedExam ? (
        <GoalStep
          kind={selectedExam.kind}
          selected={targetScore}
          onSelect={setTargetScore}
          feasibility={feasibility}
        />
      ) : null}
      {step === 5 ? (
        <SubjectsStep
          subjects={(subjectsQuery.data ?? []).map((item) => ({ id: item.id, name: item.name }))}
          strongIds={strongSubjectIds}
          weakIds={weakSubjectIds}
          onToggleStrong={(id) => {
            setWeakSubjectIds((list) => list.filter((item) => item !== id));
            setStrongSubjectIds((list) => toggleExclusive(list, id));
          }}
          onToggleWeak={(id) => {
            setStrongSubjectIds((list) => list.filter((item) => item !== id));
            setWeakSubjectIds((list) => toggleExclusive(list, id));
          }}
        />
      ) : null}
    </OnboardingShell>
  );
}

function stepCopy(step: number, kind?: ExamKind, examName?: string, tight?: boolean) {
  if (step === 0) {
    return { title: 'Koçun hazır.', subtitle: 'Sınavını ve günde kaç dakika çalışabileceğini söyle. Plan ona göre kurulur.' };
  }
  if (step === 1) {
    return { title: 'Hangi sınava hazırlanıyorsun?', subtitle: 'Kartlardan birini seç. Sonra yıl ve hedefin gelir.' };
  }
  if (step === 2) {
    return {
      title: kind === 'kpss_onlisans' ? 'Bir sonraki KPSS Önlisans' : 'Hangisine hazırlanıyorsun?',
      subtitle: examName ? `${examName} için oturum yılı.` : undefined,
    };
  }
  if (step === 3) {
    return { title: 'Günde kaç dakika çalışabilirsin?', subtitle: 'Gerçekçi bir tempo seç. Plan buna göre sıkılaşır veya rahatlar.' };
  }
  if (step === 4) {
    return { title: 'Hedefin ne?', subtitle: 'Kartlardan bir hedef seç. Tempo uygunsa planı ona göre kurarız.' };
  }
  return {
    title: tight ? 'Çıkmışlarda net getiren dersler hangisi?' : 'Güçlü ve zayıf derslerin',
    subtitle: tight ? 'Zaman dar. Çıkmış / net getiren dersleri işaretle.' : 'İstersen boş bırak. Aynı ders iki listede durmaz.',
  };
}

function WelcomeStep() {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={{
        backgroundColor: colors.navy,
        borderRadius: radius[16],
        padding: 22,
        gap: 8,
        maxWidth: 520,
      }}>
      <AppText style={{ color: '#F4F1EA' }}>TYT, AYT veya KPSS. Aynı hesap telefonda ve web’de.</AppText>
      <AppText variant="caption" style={{ color: '#D7E3F0' }}>
        Sonraki adımlarda sınav, yıl, süre ve hedefi seçeceksin.
      </AppText>
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
  const { width } = useBreakpoint();
  const cols = width >= 768 ? 3 : 2;
  const cardWidth = onboardingCardWidth(width, cols, 12, width < 768);
  return (
    <View style={{ gap: 12 }}>
      {loading ? <AppText tone="muted">Sınavlar yükleniyor…</AppText> : null}
      {error ? <AppText tone="danger">{error}</AppText> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {exams.map((exam) => (
          <View key={exam.id} style={{ width: cardWidth }}>
            <OnboardingSelectionCard
              title={exam.name}
              subtitle={examSubtitle(exam.kind)}
              icon={examIcon(exam.kind)}
              selected={selectedId === exam.id}
              onPress={() => onSelect(exam.id)}
            />
          </View>
        ))}
      </View>
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
  const { width } = useBreakpoint();
  const cols = width >= 768 ? 2 : 1;
  const cardWidth = onboardingCardWidth(width, cols, 12, width < 768);
  return (
    <View style={{ gap: 12 }}>
      {loading ? <AppText tone="muted">Oturumlar yükleniyor…</AppText> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {sessions.map((session) => (
          <View key={session.id} style={{ width: cardWidth }}>
            <OnboardingSelectionCard
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
          </View>
        ))}
      </View>
    </View>
  );
}

function MinutesStep({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { width } = useBreakpoint();
  const options = [45, 60, 90, 120, 180];
  const cols = width >= 1100 ? 5 : width >= 768 ? 3 : 2;
  const cardWidth = onboardingCardWidth(width, cols, 12, width < 768);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
      {options.map((option) => (
        <View key={option} style={{ width: cardWidth }}>
          <OnboardingSelectionCard
            title={`${option} dk`}
            subtitle={minutesHint(option)}
            icon="time-outline"
            minHeight={96}
            selected={value === option}
            onPress={() => onChange(option)}
          />
        </View>
      ))}
    </View>
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
  const { width } = useBreakpoint();
  const options = goalOptions(kind);
  const cols = width >= 768 ? 3 : 1;
  const cardWidth = onboardingCardWidth(width, cols, 12, width < 768);
  const showAlt =
    feasibility && feasibility.status === 'unrealistic' && feasibility.suggested !== feasibility.chosen;

  return (
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
        {options.map((option) => (
          <View key={option} style={{ width: cardWidth }}>
            <OnboardingSelectionCard
              title={formatGoal(option)}
              subtitle={goalHint(option)}
              icon="flag-outline"
              minHeight={112}
              selected={selected === option}
              onPress={() => onSelect(option)}
            />
          </View>
        ))}
      </View>
      {feasibility && selected != null ? (
        <View
          style={{
            maxWidth: 480,
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

function SubjectsStep({
  subjects,
  strongIds,
  weakIds,
  onToggleStrong,
  onToggleWeak,
}: {
  subjects: { id: string; name: string }[];
  strongIds: string[];
  weakIds: string[];
  onToggleStrong: (id: string) => void;
  onToggleWeak: (id: string) => void;
}) {
  const { width } = useBreakpoint();
  const cols = width >= 768 ? 3 : 2;
  const cardWidth = onboardingCardWidth(width, cols, 10, width < 768);
  return (
    <View style={{ gap: 20 }}>
      <View style={{ gap: 10 }}>
        <AppText variant="label">Zayıf olduğum dersler</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {subjects.map((subject) => (
            <View key={`w-${subject.id}`} style={{ width: cardWidth }}>
              <OnboardingSelectionCard
                title={subject.name}
                accent="weak"
                minHeight={72}
                selected={weakIds.includes(subject.id)}
                onPress={() => onToggleWeak(subject.id)}
              />
            </View>
          ))}
        </View>
      </View>
      <View style={{ gap: 10 }}>
        <AppText variant="label">Güçlü olduğum dersler</AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {subjects.map((subject) => (
            <View key={`s-${subject.id}`} style={{ width: cardWidth }}>
              <OnboardingSelectionCard
                title={subject.name}
                accent="strong"
                minHeight={72}
                selected={strongIds.includes(subject.id)}
                onPress={() => onToggleStrong(subject.id)}
              />
            </View>
          ))}
        </View>
      </View>
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

function examSubtitle(kind: ExamKind): string {
  switch (kind) {
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

function examIcon(kind: ExamKind): ComponentProps<typeof Ionicons>['name'] {
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
  if (minutes === 90) return 'Dengeli tempo';
  if (minutes === 180) return 'Yoğun çalışma';
  if (minutes === 45) return 'Kısa oturum';
  if (minutes === 120) return 'Uzun oturum';
  return undefined;
}

function goalHint(score: number): string {
  if (score === 70 || score === 200) return 'Temel hedef';
  if (score === 80 || score === 300) return 'Güçlü hedef';
  if (score === 90 || score === 400) return 'Yüksek hedef';
  return 'Hedef';
}
