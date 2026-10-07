import { useMemo, useState } from 'react';
import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { ChoiceChip } from '@/src/components/ui/ChoiceChip';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { Screen } from '@/src/components/ui/Screen';
import { SelectCard } from '@/src/components/ui/SelectCard';
import {
  assessFeasibility,
  formatGoal,
  goalOptions,
} from '@/src/features/onboarding/feasibility';
import { onboardingSchema, type OnboardingValues } from '@/src/features/onboarding/schema';
import { saveOnboarding } from '@/src/features/onboarding/saveOnboarding';
import { useExamSessions, useExams, useSubjects } from '@/src/features/onboarding/useCatalog';
import type { Exam, ExamKind, ExamSession } from '@/src/lib/supabase/types';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

const TOTAL_STEPS = 6;

function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

export function OnboardingWizard() {
  const { spacing } = useAppTheme();
  const examsQuery = useExams();
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [examId, setExamId] = useState<string | null>(null);
  const [targetScore, setTargetScore] = useState<number | null>(null);
  const [examDate, setExamDate] = useState<string | null>(null);
  const [examYear, setExamYear] = useState<number | null>(null);
  const [dailyMinutes, setDailyMinutes] = useState(90);
  const [strongSubjectIds, setStrongSubjectIds] = useState<string[]>([]);
  const [weakSubjectIds, setWeakSubjectIds] = useState<string[]>([]);

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

  const goNext = async () => {
    setError(null);
    if (step < TOTAL_STEPS - 1) {
      setStep((s) => s + 1);
      return;
    }
    setSaving(true);
    try {
      await saveOnboarding(buildValues());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kayıt tamamlanamadı');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll center={step === 0}>
      <View style={{ gap: spacing.xl }}>
        {step > 0 ? <ProgressBar value={(step + 1) / TOTAL_STEPS} /> : null}

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
            tight={feasibility?.status === 'unrealistic'}
            onToggleStrong={(id) => setStrongSubjectIds((list) => toggleId(list, id))}
            onToggleWeak={(id) => setWeakSubjectIds((list) => toggleId(list, id))}
          />
        ) : null}

        {error ? (
          <AppText tone="danger" variant="caption">
            {error}
          </AppText>
        ) : null}

        <View style={{ gap: spacing.sm }}>
          <Button
            label={step === TOTAL_STEPS - 1 ? 'Programımı oluştur' : 'Devam'}
            loading={saving}
            disabled={!canContinue()}
            onPress={() => void goNext()}
          />
          {step > 0 ? (
            <Button label="Geri" variant="ghost" disabled={saving} onPress={() => setStep((s) => s - 1)} />
          ) : null}
        </View>
      </View>
    </Screen>
  );
}

function WelcomeStep() {
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View
      style={{
        backgroundColor: colors.navy,
        borderRadius: radius.lg,
        padding: spacing.xxl,
        gap: spacing.md,
      }}>
      <AppText variant="display" style={{ color: '#F4F1EA', textAlign: 'center' }}>
        Koçun hazır.
      </AppText>
      <AppText style={{ color: '#E8E3D8', textAlign: 'center' }}>
        Sınavını ve günde kaç dakika çalışabileceğini söyle.
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
  const { spacing } = useAppTheme();
  return (
    <View style={{ gap: spacing.md }}>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        Hangi sınava hazırlanıyorsun?
      </AppText>
      {loading ? <AppText tone="muted">Sınavlar yükleniyor…</AppText> : null}
      {error ? <AppText tone="danger">{error}</AppText> : null}
      {exams.map((exam) => (
        <SelectCard
          key={exam.id}
          title={exam.name}
          subtitle={examSubtitle(exam.kind)}
          selected={selectedId === exam.id}
          onPress={() => onSelect(exam.id)}
        />
      ))}
    </View>
  );
}

function DateStep({
  kind,
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
  const { spacing } = useAppTheme();
  const title = kind === 'kpss_onlisans' ? 'Bir sonraki KPSS Önlisans' : 'Hangisine hazırlanıyorsun?';
  return (
    <View style={{ gap: spacing.md }}>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {loading ? <AppText tone="muted">Oturumlar yükleniyor…</AppText> : null}
      {sessions.map((session) => (
        <SelectCard
          key={session.id}
          title={session.exam_date ? `${examName} · ${session.exam_date}` : String(session.session_year)}
          subtitle={session.exam_date ? session.label : `${session.label} · ÖSYM tarihi henüz yok`}
          selected={examYear === session.session_year}
          onPress={() => onSelect(session)}
        />
      ))}
    </View>
  );
}

function MinutesStep({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const { spacing } = useAppTheme();
  const options = [45, 60, 90, 120, 180];
  return (
    <View style={{ gap: spacing.md, alignItems: 'center' }}>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        Günde kaç dakika çalışabilirsin?
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' }}>
        {options.map((option) => (
          <ChoiceChip
            key={option}
            label={`${option} dk`}
            selected={value === option}
            onPress={() => onChange(option)}
          />
        ))}
      </View>
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
  const { spacing } = useAppTheme();
  const options = goalOptions(kind);
  const showAlt =
    feasibility &&
    feasibility.status === 'unrealistic' &&
    feasibility.suggested !== feasibility.chosen;

  return (
    <View style={{ gap: spacing.md, alignItems: 'center' }}>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        Hedefin ne?
      </AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' }}>
        {options.map((option) => (
          <ChoiceChip
            key={option}
            label={formatGoal(option)}
            selected={selected === option}
            onPress={() => onSelect(option)}
          />
        ))}
      </View>
      {feasibility && selected != null ? (
        <Card style={{ alignSelf: 'stretch' }}>
          <View style={{ gap: spacing.sm }}>
            <AppText>{feasibility.message}</AppText>
            {showAlt ? (
              <>
                <Button
                  label={`Önerileni al (${formatGoal(feasibility.suggested)})`}
                  onPress={() => onSelect(feasibility.suggested)}
                />
                <AppText tone="muted" variant="caption">
                  Devam dersen {formatGoal(feasibility.chosen)} ile gideriz.
                </AppText>
              </>
            ) : null}
          </View>
        </Card>
      ) : null}
    </View>
  );
}

function SubjectsStep({
  subjects,
  strongIds,
  weakIds,
  tight,
  onToggleStrong,
  onToggleWeak,
}: {
  subjects: { id: string; name: string }[];
  strongIds: string[];
  weakIds: string[];
  tight: boolean;
  onToggleStrong: (id: string) => void;
  onToggleWeak: (id: string) => void;
}) {
  const { spacing } = useAppTheme();
  return (
    <View style={{ gap: spacing.lg }}>
      <AppText variant="title" style={{ textAlign: 'center' }}>
        {tight ? 'Çıkmışlarda net getiren dersler hangisi?' : 'Güçlü ve zayıf derslerin'}
      </AppText>
      <AppText tone="muted" style={{ textAlign: 'center' }}>
        {tight ? 'Zaman dar. Çıkmış / net getiren dersleri işaretle.' : 'İstersen boş bırak.'}
      </AppText>
      <AppText variant="label">Zayıf</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {subjects.map((subject) => (
          <ChoiceChip
            key={`w-${subject.id}`}
            label={subject.name}
            selected={weakIds.includes(subject.id)}
            onPress={() => onToggleWeak(subject.id)}
          />
        ))}
      </View>
      <AppText variant="label">Güçlü</AppText>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {subjects.map((subject) => (
          <ChoiceChip
            key={`s-${subject.id}`}
            label={subject.name}
            selected={strongIds.includes(subject.id)}
            onPress={() => onToggleStrong(subject.id)}
          />
        ))}
      </View>
    </View>
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
