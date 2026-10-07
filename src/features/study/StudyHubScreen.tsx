import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { Screen } from '@/src/components/ui/Screen';
import { SegmentedTabs } from '@/src/components/ui/SegmentedTabs';
import { useTodayPlan } from '@/src/features/dashboard/useDashboard';
import { PriorityTopics, TopicAccuracyRow } from '@/src/features/progress/PriorityTopics';
import { useProgressInsights } from '@/src/features/progress/useProgressInsights';
import { useStudyHub, useWrongAnswers } from '@/src/features/study/usePractice';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

type IonName = keyof typeof Ionicons.glyphMap;

function subjectIcon(slug: string, name: string): IonName {
  const key = `${slug} ${name}`.toLowerCase();
  if (key.includes('matematik')) return 'calculator-outline';
  if (key.includes('geometri')) return 'shapes-outline';
  if (key.includes('fizik')) return 'flash-outline';
  if (key.includes('kimya')) return 'flask-outline';
  if (key.includes('biyoloji')) return 'leaf-outline';
  if (key.includes('tarih') || key.includes('inkılap') || key.includes('inkilap')) return 'flag-outline';
  if (key.includes('coğraf') || key.includes('cograf')) return 'globe-outline';
  if (key.includes('felsefe')) return 'bulb-outline';
  if (key.includes('din')) return 'moon-outline';
  if (key.includes('edebiyat')) return 'library-outline';
  if (key.includes('türkçe') || key.includes('turkce') || key.includes('dil')) return 'text-outline';
  return 'book-outline';
}

function openLesson(subjectId: string, name: string, topicId?: string | null) {
  router.push({
    pathname: '/lesson',
    params: { subjectId, name, ...(topicId ? { topicId } : {}) },
  });
}

export function StudyHubScreen({ initialTab }: { initialTab?: 'lesson' | 'test' } = {}) {
  const { colors } = useAppTheme();
  const examId = useAuthStore((s) => s.profile?.exam_id);
  const examName = useAuthStore((s) => s.profile?.exam_year);
  const { isDesktop, isTablet } = useBreakpoint();
  const [tab, setTab] = useState<'lesson' | 'test'>(initialTab ?? 'lesson');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { subjectsQuery, hubQuery } = useStudyHub(examId ?? null);
  const planQuery = useTodayPlan();
  const wrongQuery = useWrongAnswers();
  const insightsQuery = useProgressInsights();
  const hub = hubQuery.data;
  const subjects = hub?.subjectStats ??
    (subjectsQuery.data ?? []).map((row) => ({
      ...row,
      topicCount: 0,
      completedTopics: 0,
      completion: 0,
      lastTopicName: null as string | null,
      topics: [] as { id: string; subject_id: string; name: string }[],
    }));
  const last = hub?.lastLesson ?? null;
  const today = hub?.today;
  const wrongCount = Math.max(insightsQuery.data?.wrong.open ?? 0, wrongQuery.data?.length ?? 0);
  const topics = insightsQuery.data?.topics ?? [];
  const priorities = insightsQuery.data?.priorities ?? [];
  const targetQuestions = planQuery.data?.target_questions ?? 0;
  const lastStats = last ? hub?.subjectStats.find((row) => row.id === last.subjectId) : undefined;
  const practiceSubject =
    subjects.find((row) => row.id === last?.subjectId && row.questionCount > 0) ??
    subjects.find((row) => row.questionCount > 0);
  const selected =
    subjects.find((row) => row.id === selectedId) ??
    subjects.find((row) => row.id === last?.subjectId) ??
    subjects[0] ??
    null;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return subjects.map((row) => ({ ...row, matchedTopic: null as string | null }));
    return subjects
      .map((row) => {
        const topicHit = row.topics?.find((topic) => topic.name.toLowerCase().includes(needle));
        const nameHit = row.name.toLowerCase().includes(needle);
        if (!nameHit && !topicHit) return null;
        return { ...row, matchedTopic: topicHit && !nameHit ? topicHit.name : null };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));
  }, [query, subjects]);

  return (
    <Screen scroll safeEdges={['top']}>
      <View style={{ gap: 16, paddingBottom: 88 }}>
        <View style={{ gap: 4 }}>
          <AppText variant="title">Dersler</AppText>
          <AppText variant="caption" tone="muted">
            {tab === 'lesson' ? 'Konuyu dinle, kaldığın yerden devam et.' : 'Hızlı, konu veya karışık test çöz.'}
          </AppText>
        </View>

        <SegmentedTabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: 'lesson', label: 'Ders' },
            { value: 'test', label: 'Test' },
          ]}
        />

        {tab === 'lesson' ? (
          <>
            {today && today.questions > 0 ? (
              <View style={{ gap: 8 }}>
                <AppText variant="label" tone="accent">
                  BUGÜNKÜ İLERLEME
                </AppText>
                <AppText variant="subtitle">
                  {today.topicCount} konu • {today.questions} soru • {today.minutes} dk
                </AppText>
                {targetQuestions > 0 ? (
                  <ProgressBar value={Math.min(1, today.questions / targetQuestions)} height={4} />
                ) : null}
              </View>
            ) : (
              <AppText variant="caption" tone="muted">
                Bugün henüz ders yok. Bir konu açınca özet burada durur.
              </AppText>
            )}

            {last ? (
              <View style={{ gap: 8 }}>
                <AppText variant="label" tone="accent">
                  DEVAM ET
                </AppText>
                <Pressable
                  onPress={() => openLesson(last.subjectId, last.subjectName, last.topicId)}
                  style={{
                    backgroundColor: colors.accentMuted,
                    borderRadius: 20,
                    padding: 14,
                    gap: 10,
                    shadowColor: '#C45C26',
                    shadowOpacity: 0.1,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 6 },
                    elevation: 2,
                  }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                    <IconBadge name={subjectIcon(lastStats?.slug ?? '', last.subjectName)} />
                    <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                      <AppText variant="subtitle" numberOfLines={1}>
                        {last.subjectName}
                      </AppText>
                      <AppText variant="caption" tone="muted" numberOfLines={1}>
                        {last.topicName ?? 'Kaldığın konu'}
                      </AppText>
                    </View>
                  </View>
                  {lastStats && lastStats.topicCount > 0 ? (
                    <>
                      <AppText variant="caption" tone="muted">
                        {lastStats.completedTopics} / {lastStats.topicCount} bölüm
                      </AppText>
                      <ProgressBar value={lastStats.completion} height={4} />
                    </>
                  ) : null}
                  <View
                    style={{
                      minHeight: 40,
                      borderRadius: 14,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: colors.accent,
                    }}>
                    <AppText variant="label" tone="inverse">
                      Devam et →
                    </AppText>
                  </View>
                </Pressable>
              </View>
            ) : null}

            <SearchField value={query} onChange={setQuery} />

            {hub ? (
              <OverallProgress
                completedTopics={hub.overall.completedTopics}
                totalTopics={hub.overall.totalTopics}
                ratio={hub.overall.ratio}
                questions={hub.overall.questions}
                ms={hub.overall.ms}
              />
            ) : null}

            {!examId ? (
              <AppText tone="muted">Önce onboarding’de sınavını seç.</AppText>
            ) : subjectsQuery.isLoading ? (
              <AppText tone="muted">Dersler yükleniyor…</AppText>
            ) : subjectsQuery.isError ? (
              <AppText tone="danger">Ders listesi alınamadı.</AppText>
            ) : filtered.length === 0 ? (
              <AppText tone="muted">Eşleşen ders veya konu yok.</AppText>
            ) : isDesktop || isTablet ? (
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 16 }}>
                <View style={{ width: isDesktop ? 260 : 220, gap: 8 }}>
                  <AppText variant="caption" tone="muted">
                    {examName ? `${examName}` : 'Sınav'}
                  </AppText>
                  {filtered.map((subject) => (
                    <Pressable
                      key={subject.id}
                      onPress={() => setSelectedId(subject.id)}
                      style={{
                        padding: 12,
                        borderRadius: 16,
                        backgroundColor: selected?.id === subject.id ? colors.accentMuted : colors.surface,
                        gap: 4,
                      }}>
                      <AppText variant="subtitle" numberOfLines={1}>
                        {subject.name}
                      </AppText>
                      <AppText variant="caption" tone="muted">
                        %{Math.round(subject.completion * 100)} • {subject.topicCount} konu
                      </AppText>
                      <ProgressBar value={subject.completion} height={3} />
                    </Pressable>
                  ))}
                </View>
                <View style={{ flex: 1.2, gap: 10, minWidth: 0 }}>
                  {selected ? (
                    <>
                      <AppText variant="title">{selected.name}</AppText>
                      <AppText variant="caption" tone="muted">
                        {selected.completedTopics}/{selected.topicCount} konu tamamlandı
                      </AppText>
                      <ProgressBar value={selected.completion} height={4} />
                      {(selected.topics ?? []).map((topic) => (
                        <Pressable
                          key={topic.id}
                          onPress={() => openLesson(selected.id, selected.name, topic.id)}
                          style={{
                            padding: 12,
                            borderRadius: 14,
                            backgroundColor: colors.surface,
                            borderWidth: 1,
                            borderColor: colors.border,
                          }}>
                          <AppText>{topic.name}</AppText>
                        </Pressable>
                      ))}
                      {selected.questionCount > 0 ? (
                        <Pressable
                          onPress={() =>
                            router.push({ pathname: '/practice', params: { subjectId: selected.id } })
                          }
                          style={{
                            minHeight: 44,
                            borderRadius: 14,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: colors.accent,
                          }}>
                          <AppText variant="label" tone="inverse">
                            Test başlat
                          </AppText>
                        </Pressable>
                      ) : null}
                    </>
                  ) : (
                    <AppText tone="muted">Soldan ders seç.</AppText>
                  )}
                </View>
                {isDesktop ? (
                  <View style={{ width: 280, gap: 12 }}>
                    {insightsQuery.data?.weekly ? (
                      <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 14, gap: 6 }}>
                        <AppText variant="label" tone="accent">
                          Haftalık ilerleme
                        </AppText>
                        <AppText>
                          {insightsQuery.data.weekly.questions} soru · {insightsQuery.data.weekly.activeDays} gün
                        </AppText>
                        {insightsQuery.data.weekly.accuracy != null ? (
                          <AppText variant="caption" tone="muted">
                            Başarı %{insightsQuery.data.weekly.accuracy}
                          </AppText>
                        ) : null}
                      </View>
                    ) : null}
                    <PriorityTopics items={priorities} />
                    {topics.length > 0 ? (
                      <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 14, gap: 12 }}>
                        <AppText variant="label" tone="accent">
                          Zayıf konular
                        </AppText>
                        {topics.slice(0, 5).map((row) => (
                          <TopicAccuracyRow key={`${row.subjectId}-${row.topicId}`} row={row} />
                        ))}
                      </View>
                    ) : null}
                    {last ? (
                      <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 14, gap: 6 }}>
                        <AppText variant="label" tone="accent">
                          Son çalışma
                        </AppText>
                        <AppText>
                          {last.subjectName}
                          {last.topicName ? ` → ${last.topicName}` : ''}
                        </AppText>
                      </View>
                    ) : null}
                    <Pressable onPress={() => useCoachStore.getState().setOpen(true)}>
                      <AppText variant="label" tone="accent">
                        Koça sor →
                      </AppText>
                    </Pressable>
                  </View>
                ) : null}
              </View>
            ) : (
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                  rowGap: 16,
                }}>
                {filtered.map((subject) => (
                  <SubjectCard
                    key={subject.id}
                    name={subject.name}
                    slug={subject.slug}
                    topicCount={subject.topicCount}
                    completion={subject.completion}
                    onPress={() => openLesson(subject.id, subject.name)}
                  />
                ))}
              </View>
            )}
          </>
        ) : (
          <>
            <View style={{ gap: 8 }}>
              <AppText variant="label" tone="accent">
                TEST MERKEZİ
              </AppText>
              {today && today.questions > 0 ? (
                <View
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 20,
                    padding: 14,
                    gap: 10,
                  }}>
                  <AppText variant="caption" tone="muted">
                    Bugünkü test özeti
                  </AppText>
                  <View style={{ flexDirection: 'row' }}>
                    <MiniStat label={`${today.questions}`} hint="soru" />
                    <MiniStat label={`${today.correct}`} hint="doğru" />
                    <MiniStat label={`${today.wrong}`} hint="yanlış" />
                    {today.blank > 0 ? <MiniStat label={`${today.blank}`} hint="boş" /> : null}
                    {today.accuracy != null ? <MiniStat label={`%${today.accuracy}`} hint="başarı" /> : null}
                  </View>
                </View>
              ) : (
                <AppText variant="caption" tone="muted">
                  Bugün henüz test yok. Bir set bitince özet burada durur.
                </AppText>
              )}
            </View>

            <View style={{ gap: 8 }}>
              <TestEntry
                icon="calendar-outline"
                title="Sistem Sınavları"
                hint="Merkezi TYT, AYT ve KPSS denemeleri"
                onPress={() => router.push('/system-exams')}
              />
              <TestEntry
                icon="flash-outline"
                title="Hızlı Test"
                hint="10 soruluk hızlı çalışma"
                onPress={() => {
                  if (practiceSubject) {
                    router.push({ pathname: '/practice', params: { subjectId: practiceSubject.id } });
                    return;
                  }
                  router.push('/study');
                }}
              />
              <TestEntry
                icon="list-outline"
                title="Konu Testi"
                hint="Ders ve konu seç"
                onPress={() => {
                  if (last) {
                    openLesson(last.subjectId, last.subjectName, last.topicId);
                    return;
                  }
                  const first = subjects[0];
                  if (first) openLesson(first.id, first.name);
                }}
              />
              <TestEntry
                icon="shuffle-outline"
                title="Karma Test"
                hint="Farklı derslerden karışık test"
                onPress={() => router.push({ pathname: '/practice', params: { mode: 'mixed' } })}
              />
            </View>

            {wrongCount > 0 ? (
              <View style={{ gap: 8 }}>
                <AppText variant="label" tone="accent">
                  YANLIŞLARIM
                </AppText>
                <Pressable
                  onPress={() => router.push('/notebook')}
                  style={{
                    backgroundColor: colors.surface,
                    borderRadius: 20,
                    padding: 14,
                    gap: 8,
                  }}>
                  <AppText>
                    {wrongCount} açık yanlışın var. Tekrar sırası dolunca üst üste gelmez.
                  </AppText>
                  <AppText variant="label" tone="accent">
                    Defteri aç
                  </AppText>
                </Pressable>
              </View>
            ) : null}

            <PriorityTopics items={priorities} />

            {topics.length > 0 ? (
              <View style={{ gap: 8 }}>
                <AppText variant="label" tone="accent">
                  KONU ANALİZİ
                </AppText>
                <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 14, gap: 12 }}>
                  {topics.slice(0, 8).map((row) => (
                    <TopicAccuracyRow key={`${row.subjectId}-${row.topicId}`} row={row} />
                  ))}
                </View>
              </View>
            ) : null}

            <View style={{ gap: 8 }}>
              <AppText variant="label" tone="accent">
                DERS BAZLI TEST
              </AppText>
              {!examId ? (
                <AppText tone="muted">Önce onboarding’de sınavını seç.</AppText>
              ) : (
                <View style={{ backgroundColor: colors.surface, borderRadius: 20, overflow: 'hidden' }}>
                  {(hub?.subjectStats ?? subjects).map((subject, index) => (
                    <Pressable
                      key={subject.id}
                      onPress={() => {
                        if (subject.questionCount > 0) {
                          router.push({ pathname: '/practice', params: { subjectId: subject.id } });
                        }
                      }}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 10,
                        paddingHorizontal: 12,
                        paddingVertical: 12,
                        opacity: subject.questionCount > 0 ? 1 : 0.55,
                        borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                        borderTopColor: colors.bgMuted,
                      }}>
                      <IconBadge name={subjectIcon(subject.slug, subject.name)} muted />
                      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
                        <AppText numberOfLines={1}>{subject.name}</AppText>
                        <AppText variant="caption" tone="muted">
                          {subject.questionCount > 0
                            ? `${subject.questionCount} soru${
                                subject.topicCount > 0 ? ` • %${Math.round(subject.completion * 100)}` : ''
                              }`
                            : 'Bu derste henüz soru yok'}
                        </AppText>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                    </Pressable>
                  ))}
                  {subjects.length === 0 ? (
                    <View style={{ padding: 14 }}>
                      <AppText tone="muted">Ders listesi boş.</AppText>
                    </View>
                  ) : null}
                </View>
              )}
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

function SearchField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        minHeight: 44,
        borderRadius: 16,
        paddingHorizontal: 12,
        backgroundColor: colors.surface,
      }}>
      <Ionicons name="search-outline" size={18} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="Ders veya konu ara"
        placeholderTextColor={colors.textSubtle}
        autoCapitalize="none"
        autoCorrect={false}
        style={{ flex: 1, fontSize: 15, color: colors.text, paddingVertical: 10 }}
      />
    </View>
  );
}

function OverallProgress({
  completedTopics,
  totalTopics,
  ratio,
  questions,
  ms,
}: {
  completedTopics: number;
  totalTopics: number;
  ratio: number;
  questions: number;
  ms: number | null;
}) {
  const { colors } = useAppTheme();
  if (totalTopics <= 0) {
    return (
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: 22,
          paddingVertical: 12,
          paddingHorizontal: 14,
          gap: 4,
        }}>
        <AppText variant="label" tone="accent">
          Genel ilerleme
        </AppText>
        <AppText variant="caption" tone="muted">
          İçeriği olan dersler gelince tamamlanma burada toplanır.
        </AppText>
      </View>
    );
  }

  const hours = ms != null ? (ms / 3_600_000).toFixed(1) : null;

  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderRadius: 22,
        paddingVertical: 12,
        paddingHorizontal: 14,
        gap: 8,
        shadowColor: '#142033',
        shadowOpacity: 0.04,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: 1,
      }}>
      <AppText variant="label" tone="accent">
        Genel ilerleme
      </AppText>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <AppText variant="subtitle">%{Math.round(ratio * 100)} tamamlandı</AppText>
        <AppText variant="caption" tone="muted">
          {completedTopics} / {totalTopics} konu
        </AppText>
      </View>
      <ProgressBar value={ratio} height={4} />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
          {completedTopics} konu
        </AppText>
        <AppText variant="caption" tone="muted" style={{ flex: 1, textAlign: 'center' }}>
          {questions} soru
        </AppText>
        {hours != null ? (
          <AppText variant="caption" tone="muted" style={{ flex: 1, textAlign: 'right' }}>
            {hours} saat
          </AppText>
        ) : (
          <View style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

function SubjectCard({
  name,
  slug,
  topicCount,
  completion,
  onPress,
}: {
  name: string;
  slug: string;
  topicCount: number;
  completion: number;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const upcoming = topicCount <= 0;
  const done = !upcoming && completion >= 1;
  const started = !upcoming && completion > 0 && completion < 1;
  const pct = Math.round(completion * 100);

  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '48%',
        borderRadius: 22,
        padding: 12,
        gap: 8,
        backgroundColor: started ? colors.accentMuted : colors.surface,
        opacity: upcoming ? 0.72 : 1,
        shadowColor: '#142033',
        shadowOpacity: upcoming ? 0.02 : 0.05,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 4 },
        elevation: upcoming ? 0 : 1,
      }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <IconBadge name={subjectIcon(slug, name)} muted={!started} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          {done ? <Ionicons name="checkmark-circle" size={16} color={colors.accent} /> : null}
          <Ionicons name="chevron-forward" size={14} color={upcoming ? colors.textSubtle : colors.textMuted} />
        </View>
      </View>
      <AppText variant="subtitle" numberOfLines={1} style={{ fontSize: 16 }}>
        {name}
      </AppText>
      {upcoming ? (
        <View
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 999,
            backgroundColor: colors.bgMuted,
          }}>
          <AppText variant="caption" tone="muted" style={{ fontSize: 11, lineHeight: 14 }}>
            Yakında
          </AppText>
        </View>
      ) : (
        <>
          <AppText variant="caption" tone="muted" numberOfLines={1}>
            {topicCount} konu
          </AppText>
          <AppText variant="caption" tone={started || done ? 'accent' : 'muted'} numberOfLines={1}>
            %{pct} tamamlandı
          </AppText>
          <ProgressBar value={completion} height={3} />
        </>
      )}
    </Pressable>
  );
}

function IconBadge({ name, muted }: { name: IonName; muted?: boolean }) {
  const { colors } = useAppTheme();
  return (
    <View
      style={{
        width: 40,
        height: 40,
        borderRadius: 14,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: muted ? colors.surfaceMuted : colors.surface,
      }}>
      <Ionicons name={name} size={20} color={colors.accent} />
    </View>
  );
}

function MiniStat({ label, hint }: { label: string; hint: string }) {
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 1 }}>
      <AppText variant="label">{label}</AppText>
      <AppText variant="caption" tone="muted" style={{ fontSize: 11, lineHeight: 14 }}>
        {hint}
      </AppText>
    </View>
  );
}

function TestEntry({
  icon,
  title,
  hint,
  onPress,
}: {
  icon: IonName;
  title: string;
  hint: string;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        backgroundColor: colors.surface,
        borderRadius: 18,
        paddingVertical: 12,
        paddingHorizontal: 12,
      }}>
      <IconBadge name={icon} muted />
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="subtitle">{title}</AppText>
        <AppText variant="caption" tone="muted">
          {hint}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </Pressable>
  );
}
