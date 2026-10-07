import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { EmptyState } from '@/src/components/ui/EmptyState';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { Screen } from '@/src/components/ui/Screen';
import { toastError } from '@/src/components/ui/feedbackStore';
import { coachCopy } from '@/src/features/dashboard/coach';
import {
    planProgress,
    taskSolvedCount,
    useExamName,
    useStreak,
    useTodayAttempts,
    useTodayPlan,
    useWeeklyStats,
} from '@/src/features/dashboard/useDashboard';
import { PriorityTopics } from '@/src/features/progress/PriorityTopics';
import { WeeklyActivityCard } from '@/src/features/progress/WeeklyActivityCard';
import { useProgressInsights } from '@/src/features/progress/useProgressInsights';
import { formatXp, getLevelProgress } from '@/src/features/progress/xp';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { postedAt, taggedName } from '@/src/features/social/identity';
import { useOpenRooms, useSocialPreview } from '@/src/features/social/useSocial';
import { useJoinExamLobby, useNotifications } from '@/src/features/study/useStudyTogether';
import { UpcomingExamCard } from '@/src/features/system-exams/UpcomingExamCard';
import { useUpcomingSystemExam } from '@/src/features/system-exams/useSystemExams';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import type { StudyTask } from '@/src/lib/supabase/types';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { greetingForHour } from '@/src/lib/time/greeting';
import { useAuthStore } from '@/src/stores/authStore';

function openTask(task: StudyTask) {
  if (task.subject_id) {
    router.push({ pathname: '/practice', params: { subjectId: task.subject_id } });
    return;
  }
  if (task.kind === 'review' || task.title.toLowerCase().includes('yanlış')) {
    router.push({ pathname: '/practice', params: { mode: 'review' } });
    return;
  }
  router.push('/study');
}

function focusTitle(title: string) {
  const parts = title.split(/\s+[–—•-]\s+/);
  if (parts.length >= 2) return { subject: parts[0], topic: parts.slice(1).join(' • ') };
  return { subject: title, topic: null as string | null };
}

export function HomeScreen() {
  const { colors, radius, shadows } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const xpProgress = getLevelProgress(profile?.current_xp ?? 0);
  const name = profile?.display_name || session?.user.user_metadata?.display_name || 'öğrenci';
  const hour = new Date().getHours();
  const planQuery = useTodayPlan();
  const streakQuery = useStreak();
  const examQuery = useExamName();
  const attemptsQuery = useTodayAttempts();
  const weeklyQuery = useWeeklyStats();
  const insightsQuery = useProgressInsights();
  const roomsQuery = useOpenRooms();
  const socialQuery = useSocialPreview();
  const notifications = useNotifications();
  const joinExam = useJoinExamLobby();
  const upcomingExam = useUpcomingSystemExam();
  const [showAllTasks, setShowAllTasks] = useState(false);

  const plan = planQuery.data ?? null;
  const attempts = attemptsQuery.data ?? [];
  const progress = planProgress(plan, attempts);
  const streak = streakQuery.data?.current_streak ?? 0;
  const examName = examQuery.data;
  const coach = coachCopy({ name: String(name), plan, attempts, hour });
  const tasks = plan?.study_tasks ?? [];
  const visibleTasks = showAllTasks ? tasks : tasks.slice(0, 3);
  const hiddenCount = Math.max(0, tasks.length - 3);
  const liveRooms = (roomsQuery.data ?? [])
    .filter((room) => room.mode !== 'race' && (room.status === 'waiting' || room.status === 'countdown'))
    .slice(0, 2);
  const posts = socialQuery.data ?? [];
  const weekly = weeklyQuery.data;
  const insights = insightsQuery.data;
  const report = insights?.weekly?.questions
    ? insights.weekly
    : weekly
      ? {
          questions: weekly.current.count,
          ms: weekly.current.ms,
          accuracy: null as number | null,
          activeDays: weekly.current.active,
          questionDelta: weekly.delta,
          accuracyDelta: null as number | null,
          strongest: null as string | null,
          weakest: null as string | null,
          bars: weekly.bars,
        }
      : null;
  const goalPct = Math.round(progress.ratio * 100);
  const examLine = [examName, profile?.exam_year].filter(Boolean).join(' ');
  const focus = coach.task ? focusTitle(coach.task.title) : null;
  const solved = coach.task ? taskSolvedCount(coach.task, attempts) : 0;
  const target = coach.task?.question_count ?? 0;

  const header = (
    <PageHeader
      title={greetingForHour(hour, String(name))}
      subtitle={examLine || undefined}
      right={
        <Pressable
          onPress={() => router.push('/notifications')}
          accessibilityLabel="Bildirimler"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="notifications-outline" size={24} color={colors.text} />
          {notifications.unread > 0 ? (
            <View
              style={{
                position: 'absolute',
                right: 6,
                top: 6,
                minWidth: 16,
                height: 16,
                borderRadius: 8,
                backgroundColor: colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: 4,
              }}>
              <AppText variant="caption" tone="inverse" style={{ fontSize: 10 }}>
                {notifications.unread > 9 ? '9+' : notifications.unread}
              </AppText>
            </View>
          ) : null}
        </Pressable>
      }
    />
  );

  const stats = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      <StatPill icon="flame" label={streak > 0 ? `${streak} gün seri` : 'Seri yok'} />
      <StatPill icon="flash" label={`Lv.${xpProgress.level} • ${formatXp(xpProgress.xpInLevel)} XP`} />
      <StatPill icon="radio-button-on" label={`%${goalPct} günlük hedef`} />
    </View>
  );

  const weeklyCard = (
        <WeeklyActivityCard
          questions={report?.questions ?? 0}
          ms={report?.ms ?? 0}
          activeDays={report?.activeDays ?? 0}
          bars={report?.bars ?? [0, 0, 0, 0, 0, 0, 0]}
          days={weekly?.days}
          questionDelta={report?.questionDelta ?? null}
        />
  );

  const examCard = upcomingExam.data ? <UpcomingExamCard exam={upcomingExam.data} /> : null;

  const focusCard = (
    <View
      style={{
        backgroundColor: colors.accentMuted,
        borderRadius: radius.xl,
        padding: 18,
        gap: 10,
        borderWidth: 1,
        borderColor: colors.accent,
        ...shadows.md,
      }}>
      <AppText variant="label" tone="accent">
        Bugünkü Odak
      </AppText>
      {coach.task ? (
        <>
          <AppText variant="title">{focus?.subject}</AppText>
          {focus?.topic ? (
            <AppText variant="caption" tone="muted">
              {focus.topic}
            </AppText>
          ) : null}
          {target > 0 ? (
            <>
              <AppText variant="caption" tone="muted">
                {Math.min(solved, target)}/{target}
              </AppText>
              <ProgressBar value={Math.min(1, solved / target)} height={6} />
            </>
          ) : (
            <AppText variant="caption" tone="muted">
              {coach.body}
            </AppText>
          )}
          <Button label="Devam et" onPress={() => openTask(coach.task!)} />
        </>
      ) : (
        <>
          <AppText variant="subtitle">{coach.headline}</AppText>
          <AppText variant="caption" tone="muted">
            {coach.body}
          </AppText>
          <Button label="Derse geç" onPress={() => router.push('/study')} />
        </>
      )}
    </View>
  );

  const liveCard = (
        <Section
          title="Şu an çalışılıyor"
          action="Tümü"
          onAction={() => router.push('/social')}>
          {roomsQuery.isError ? (
            <AppText tone="danger">Odalar alınamadı.</AppText>
          ) : liveRooms.length === 0 ? (
            <EmptyState
              icon="people-outline"
              title="Şu anda açık oda yok."
              actionLabel="Oda aç"
              onAction={() => router.push('/social')}
            />
          ) : (
            <View style={{ gap: 10 }}>
              {liveRooms.map((room) => (
                <View key={room.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 52 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <AppText variant="subtitle">{room.subject_name ?? room.title ?? 'Oda'}</AppText>
                    <AppText variant="caption" tone="muted">
                      {room.title && room.subject_name ? room.title : `${room.member_count}/${room.capacity} kişi`}
                      {room.title && room.subject_name
                        ? ` · ${room.member_count}/${room.capacity} kişi`
                        : ''}
                      {room.member_count >= room.capacity ? ' • Dolu' : ''}
                    </AppText>
                  </View>
                  <Pressable
                    onPress={() => {
                      if (room.member_count >= room.capacity) return;
                      if (room.has_password) {
                        router.push('/social');
                        return;
                      }
                      void joinExam.mutateAsync(room.id).then(
                        () => router.push({ pathname: '/study-room', params: { sessionId: room.id } }),
                        (error: unknown) => toastError(error),
                      );
                    }}
                    disabled={room.member_count >= room.capacity}
                    style={{ minHeight: 36, paddingHorizontal: 12, justifyContent: 'center', opacity: room.member_count >= room.capacity ? 0.45 : 1 }}>
                    <AppText tone="accent" style={{ fontWeight: '700' }}>
                      {room.member_count >= room.capacity ? 'Dolu' : 'Katıl'}
                    </AppText>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
        </Section>
  );

  const tasksCard = (
        <Card header="Görevler">
          {planQuery.isLoading ? (
            <AppText tone="muted">Plan yükleniyor…</AppText>
          ) : planQuery.isError ? (
            <AppText tone="danger">Plan alınamadı.</AppText>
          ) : visibleTasks.length ? (
            <>
              {visibleTasks.map((task) => (
                <TaskRow key={task.id} task={task} attempts={attempts} />
              ))}
              {hiddenCount > 0 && !showAllTasks ? (
                <Pressable onPress={() => setShowAllTasks(true)} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <AppText tone="accent">{hiddenCount} görevi daha göster ↓</AppText>
                </Pressable>
              ) : null}
            </>
          ) : (
            <EmptyState icon="checkbox-outline" title="Bugün için görev yok." />
          )}
        </Card>
  );

  const socialCard = (
        <Section title="Topluluktan" action="Tümü" onAction={() => router.push('/social')} kicker>
          {posts.length === 0 ? (
            <EmptyState icon="chatbubble-ellipses-outline" title="Henüz durum yok." actionLabel="Sosyale git" onAction={() => router.push('/social')} />
          ) : (
            <View style={{ gap: 8 }}>
              {posts.map((post, index) => (
                <Pressable
                  key={post.id}
                  onPress={() => router.push('/social')}
                  style={{
                    flexDirection: 'row',
                    gap: 10,
                    alignItems: 'flex-start',
                    padding: index === 0 ? 10 : 4,
                    marginHorizontal: index === 0 ? -4 : 0,
                    borderRadius: 16,
                    backgroundColor: index === 0 ? colors.accentMuted : 'transparent',
                  }}>
                  <LetterAvatar id={post.user_id} name={post.display_name} size={index === 0 ? 40 : 34} />
                  <View style={{ flex: 1, gap: 2 }}>
                    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                      <AppText variant={index === 0 ? 'label' : 'caption'} style={{ fontWeight: '700' }}>
                        {taggedName(post.display_name, post.display_tag)}
                      </AppText>
                      {post.is_bot ? (
                        <AppText variant="caption" tone="muted">
                          otomatik
                        </AppText>
                      ) : null}
                      <AppText variant="caption" tone="subtle">
                        {postedAt(post.created_at)}
                      </AppText>
                    </View>
                    <AppText variant={index === 0 ? 'body' : 'caption'} numberOfLines={2} style={index === 0 ? { fontSize: 15, lineHeight: 21 } : undefined}>
                      {post.body}
                    </AppText>
                    {(post.like_count ?? 0) > 0 ? (
                      <AppText variant="caption" tone="muted">
                        ♥ {post.like_count}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              ))}
              <Pressable onPress={() => router.push('/social')} style={{ minHeight: 36, justifyContent: 'center' }}>
                <AppText variant="label" tone="accent">
                  Sosyale git →
                </AppText>
              </Pressable>
            </View>
          )}
        </Section>
  );

  return (
    <Screen scroll>
      <View style={{ gap: 16 }}>
        {header}
        {stats}
        {isDesktop ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 24 }}>
            <View style={{ flex: 2, gap: 16, minWidth: 0 }}>{weeklyCard}{focusCard}{tasksCard}</View>
            <View style={{ flex: 1, gap: 16, minWidth: 0 }}>
              {examCard}
              {liveCard}
              {socialCard}
              <PriorityTopics items={insights?.priorities ?? []} />
            </View>
          </View>
        ) : (
          <>
            {examCard}
            {weeklyCard}
            {focusCard}
            {liveCard}
            {tasksCard}
            {socialCard}
            <PriorityTopics items={insights?.priorities ?? []} />
          </>
        )}
      </View>
    </Screen>
  );
}

function TaskRow({
  task,
  attempts,
}: {
  task: StudyTask;
  attempts: Parameters<typeof taskSolvedCount>[1];
}) {
  const { colors } = useAppTheme();
  const count = taskSolvedCount(task, attempts);
  const targetCount = task.question_count ?? 0;
  const done = task.status === 'completed' || (targetCount > 0 && count >= targetCount);
  const shown = done ? targetCount : Math.min(count, targetCount);
  const scale = useRef(new Animated.Value(done ? 1 : 0.7)).current;
  const glow = useRef(new Animated.Value(done ? 1 : 0)).current;
  const wasDone = useRef(done);

  useEffect(() => {
    if (done && !wasDone.current) {
      scale.setValue(0.55);
      glow.setValue(0);
      Animated.parallel([
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 140, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 1, duration: 280, useNativeDriver: true }),
      ]).start();
    }
    wasDone.current = done;
  }, [done, glow, scale]);

  return (
    <Pressable onPress={() => openTask(task)} style={{ paddingVertical: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Animated.View
          style={{
            width: 22,
            height: 22,
            borderRadius: 7,
            backgroundColor: done ? colors.accent : 'transparent',
            borderWidth: done ? 0 : 1.5,
            borderColor: colors.border,
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale }],
            opacity: done ? glow.interpolate({ inputRange: [0, 1], outputRange: [0.65, 1] }) : 1,
          }}>
          {done ? <Ionicons name="checkmark" size={14} color={colors.accentText} /> : null}
        </Animated.View>
        <View style={{ flex: 1, gap: 5, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <AppText
              numberOfLines={1}
              style={{ flex: 1, fontSize: 15, textDecorationLine: done ? 'line-through' : 'none' }}
              tone={done ? 'muted' : 'primary'}>
              {task.title}
            </AppText>
            <AppText variant="caption" tone={done ? 'accent' : 'muted'} style={{ minWidth: 36, textAlign: 'right', fontVariant: ['tabular-nums'] }}>
              {shown}/{targetCount}
            </AppText>
          </View>
          <ProgressBar value={targetCount > 0 ? shown / targetCount : 0} height={3} />
        </View>
      </View>
    </Pressable>
  );
}

function Section({
  title,
  action,
  onAction,
  kicker,
  children,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  kicker?: boolean;
  children: ReactNode;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        {kicker ? (
          <AppText variant="label" tone="accent" style={{ letterSpacing: 0.8 }}>
            {title.toUpperCase()}
          </AppText>
        ) : (
          <AppText variant="subtitle">{title}</AppText>
        )}
        {action ? (
          <Pressable onPress={onAction} hitSlop={8} style={{ minHeight: 28, justifyContent: 'center' }}>
            <AppText variant="caption" tone="accent">
              {action}
            </AppText>
          </Pressable>
        ) : null}
      </View>
      <View style={{ backgroundColor: colors.surface, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 10 }}>
        {children}
      </View>
    </View>
  );
}

function StatPill({ icon, label }: { icon: ComponentProps<typeof Ionicons>['name']; label: string }) {
  const { colors, radius } = useAppTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: radius.pill,
        paddingHorizontal: 14,
        paddingVertical: 10,
      }}>
      <Ionicons name={icon} size={16} color={colors.accent} />
      <AppText variant="label">{label}</AppText>
    </View>
  );
}
