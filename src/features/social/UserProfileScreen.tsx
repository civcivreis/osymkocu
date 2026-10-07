import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';

import { ActionSheet } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { Card } from '@/src/components/ui/Card';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { ProgressBar } from '@/src/components/ui/ProgressBar';
import { Screen } from '@/src/components/ui/Screen';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';
import { formatXp, getLevelProgress } from '@/src/features/progress/xp';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { EditPostSheet, ReportSheet, StudyInviteSheet } from '@/src/features/social/ReportSheet';
import { postedAt, taggedName } from '@/src/features/social/identity';
import {
    followLabel,
    formatStudyDuration,
    useFollowUser,
    useProfileCard,
    useUnfollowUser,
    type ProfileCard,
} from '@/src/features/social/useFollows';
import { useBlockUser, useDeleteOwnPost, useReportUser, useUpdateOwnPost } from '@/src/features/social/useSocial';
import { useStudySubjects, useSubjectTopics } from '@/src/features/study/usePractice';
import { useRequestStudy } from '@/src/features/study/useStudyTogether';
import { useSystemExamProfileStats } from '@/src/features/system-exams/useSystemExams';
import { isBlockedRoomMessage } from '@/src/lib/moderation/profanity';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

function focusLine(card: ProfileCard) {
  const exam = card.exam_name ?? (card.exam_year ? `${card.exam_year}` : null);
  const focus = card.top_subject ?? (card.bio ? card.bio.split(/[·•,]/)[0]?.trim() : null);
  if (exam && focus) return `${exam} • ${focus}`;
  return exam ?? focus ?? 'Öğrenci';
}

function CompactButton({
  label,
  tone,
  onPress,
  loading,
}: {
  label: string;
  tone: 'primary' | 'neutral';
  onPress: () => void;
  loading?: boolean;
}) {
  const { colors } = useAppTheme();
  const primary = tone === 'primary';
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: primary ? colors.accent : colors.surface,
        borderWidth: primary ? 0 : 1,
        borderColor: colors.border,
      }}>
      <AppText variant="label" tone={primary ? 'inverse' : 'primary'} style={{ fontWeight: '700' }}>
        {loading ? '…' : label}
      </AppText>
    </Pressable>
  );
}

export function UserProfileScreen({
  userId,
  embedded,
}: {
  userId?: string;
  embedded?: boolean;
} = {}) {
  const { colors, spacing } = useAppTheme();
  const params = useLocalSearchParams<{ userId?: string; postId?: string; subjectId?: string }>();
  const id = userId ?? String(params.userId ?? '');
  const me = useAuthStore((s) => s.session?.user.id);
  const examId = useAuthStore((s) => s.profile?.exam_id);
  const mine = Boolean(me && id && id === me);
  const cardQuery = useProfileCard(id || null);
  const follow = useFollowUser();
  const unfollow = useUnfollowUser();
  const blockUser = useBlockUser();
  const reportUser = useReportUser();
  const requestStudy = useRequestStudy();
  const removePost = useDeleteOwnPost();
  const updatePost = useUpdateOwnPost();
  const subjectsQuery = useStudySubjects(examId ?? null);
  const [studyOpen, setStudyOpen] = useState(false);
  const [pickedSubject, setPickedSubject] = useState(String(params.subjectId ?? '') || null);
  const [pickedTopic, setPickedTopic] = useState<string | null>(null);
  const [profileMenu, setProfileMenu] = useState(false);
  const [postMenu, setPostMenu] = useState<{ id: string; body: string } | null>(null);
  const topicsQuery = useSubjectTopics(pickedSubject);
  const [showAllPosts, setShowAllPosts] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editPost, setEditPost] = useState<{ id: string; body: string } | null>(null);
  const meXp = useAuthStore((s) => s.profile?.current_xp);
  const examStats = useSystemExamProfileStats(mine ? id : null);
  const card = cardQuery.data;
  const xpTotal = mine ? (meXp ?? card?.current_xp ?? 0) : (card?.current_xp ?? 0);
  const xpProgress = getLevelProgress(xpTotal);
  const name = taggedName(card?.display_name, card?.display_tag);
  const posts = (card?.posts ?? []).slice(0, showAllPosts ? 12 : 3);
  const hasWeek = Boolean(card && (card.week_questions > 0 || card.week_ms > 0));
  const selectedSubjects = useQuery({
    queryKey: ['exam-settings', id],
    enabled: mine && Boolean(id),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('user_exam_settings')
        .select('perceived_weak_subject_ids')
        .eq('user_id', id)
        .maybeSingle();
      if (error) throw error;
      return (data?.perceived_weak_subject_ids ?? []) as string[];
    },
  });
  const subjectChips = useMemo(() => {
    const selected = selectedSubjects.data ?? [];
    const named = (subjectsQuery.data ?? [])
      .filter((item) => selected.includes(item.id))
      .map((item) => ({ id: item.id, name: item.name }));
    if (named.length > 0) return named;
    return card?.subjects ?? [];
  }, [card?.subjects, selectedSubjects.data, subjectsQuery.data]);

  const onFollow = () => {
    if (!id) return;
    if (card?.i_follow || card?.follow_pending) {
      void unfollow.mutateAsync(id).then(undefined, (error: unknown) => {
        toastError(error);
      });
      return;
    }
    void follow.mutateAsync(id).then(undefined, (error: unknown) => {
      toastError(error);
    });
  };

  const onMenu = () => setProfileMenu(true);

  const inner = (
    <View style={{ gap: spacing.md, paddingBottom: embedded ? 8 : 20 }}>
      <PageHeader title="Profil" />
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        {embedded ? null : (
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
        )}
        <AppText variant="subtitle" style={{ flex: 1, textAlign: embedded ? 'left' : 'center' }}>
          Profil
        </AppText>
        {mine ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable onPress={() => router.push('/edit-profile')} hitSlop={8}>
              <AppText variant="label" tone="accent">Düzenle</AppText>
            </Pressable>
            <Pressable onPress={() => router.push('/settings')} hitSlop={8}>
              <AppText variant="label" tone="muted">Ayarlar</AppText>
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={onMenu} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        )}
      </View>

      {cardQuery.isLoading ? <AppText tone="muted">Profil yükleniyor…</AppText> : null}
      {cardQuery.isError ? <AppText tone="danger">Profil alınamadı.</AppText> : null}

          {card ? (
        <View style={{ alignItems: 'center', gap: 8, paddingTop: 4 }}>
          <View
            style={{
              padding: card.has_story ? 3 : 0,
              borderRadius: 999,
              borderWidth: card.has_story ? 3 : 0,
              borderColor: colors.accent,
            }}>
            <LetterAvatar id={id} name={card.display_name} size={84} imageUrl={card.avatar_url} />
          </View>
          <AppText variant="title">{name}</AppText>
          {card.is_bot ? (
            <AppText variant="caption" tone="muted">
              Otomatik çalışma hesabı
            </AppText>
          ) : null}
          {mine ? (
            <View style={{ width: '100%', gap: 8, paddingHorizontal: 12 }}>
              <AppText variant="subtitle" style={{ textAlign: 'center' }}>
                Seviye {xpProgress.level}
              </AppText>
              <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                {formatXp(xpProgress.xpInLevel)} / {formatXp(xpProgress.xpForNext)} XP
              </AppText>
              <ProgressBar value={xpProgress.ratio} height={5} />
              {examStats.data && examStats.data.count > 0 ? (
                <Pressable onPress={() => router.push('/system-exams')} style={{ gap: 2, paddingTop: 4 }}>
                  <AppText variant="caption" style={{ textAlign: 'center' }}>
                    Sistem sınavları
                  </AppText>
                  <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
                    {examStats.data.count} sınava katıldı
                    {examStats.data.best_percentile != null ? ` • En iyi yüzdelik %${examStats.data.best_percentile}` : ''}
                    {examStats.data.last_net != null ? ` • Son sınav ${examStats.data.last_net} net` : ''}
                  </AppText>
                </Pressable>
              ) : null}
            </View>
          ) : (
            <AppText variant="caption" tone="muted">
              Seviye {xpProgress.level}
            </AppText>
          )}
          <AppText tone="muted">{focusLine(card)}</AppText>
          {card.bio ? (
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              {card.bio}
            </AppText>
          ) : null}
          {card.i_follow && card.follows_me && !mine ? (
            <AppText variant="caption" tone="accent">
              Karşılıklı takip
            </AppText>
          ) : null}
        </View>
      ) : null}

      {card ? (
        <View style={{ flexDirection: 'row', paddingVertical: 6 }}>
          {(
            [
              { n: card.follower_count, l: 'Takipçi', dir: 'followers' as const },
              { n: card.following_count, l: 'Takip', dir: 'following' as const },
              { n: card.streak, l: 'Seri', dir: null },
            ] as const
          ).map((item) => (
            <Pressable
              key={item.l}
              onPress={
                item.dir
                  ? () => router.push({ pathname: '/follows', params: { userId: id, dir: item.dir, name } })
                  : undefined
              }
              style={{ flex: 1, alignItems: 'center', gap: 2 }}>
              <AppText variant="title">{item.n}</AppText>
              <AppText variant="caption" tone="muted">
                {item.l}
              </AppText>
            </Pressable>
          ))}
        </View>
      ) : null}

      {mine && card ? (
        <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 8 }}>
          <Pressable
            onPress={() => router.push('/edit-profile')}
            style={{
              flex: 1,
              minHeight: 44,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 16,
              backgroundColor: colors.accent,
            }}>
            <AppText variant="label" tone="inverse">
              Profili düzenle
            </AppText>
          </Pressable>
          <Pressable
            onPress={() => router.push('/settings')}
            style={{
              flex: 1,
              minHeight: 44,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              borderRadius: 16,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <Ionicons name="settings-outline" size={16} color={colors.text} />
            <AppText variant="label">Ayarlar</AppText>
          </Pressable>
        </View>
      ) : null}

      {!mine && card ? (
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <CompactButton
              label={followLabel(card)}
              tone={card.i_follow || card.follow_pending ? 'neutral' : 'primary'}
              loading={follow.isPending || unfollow.isPending}
              onPress={onFollow}
            />
            <CompactButton
              label="Mesaj"
              tone="neutral"
              onPress={() => router.push({ pathname: '/chat', params: { userId: id, name } })}
            />
          </View>
          <Pressable
            onPress={() => setStudyOpen(true)}
            style={{
              alignSelf: 'center',
              paddingHorizontal: 16,
              paddingVertical: 10,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.surface,
            }}>
            <AppText variant="label">Birlikte çalış</AppText>
          </Pressable>
        </View>
      ) : null}

      {hasWeek && card ? (
        <Card>
          <View style={{ gap: 10 }}>
            <AppText variant="subtitle">Bu hafta</AppText>
            <View style={{ flexDirection: 'row' }}>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <AppText variant="subtitle">{card.week_questions}</AppText>
                <AppText variant="caption" tone="muted">
                  soru
                </AppText>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <AppText variant="subtitle">{formatStudyDuration(card.week_ms)}</AppText>
                <AppText variant="caption" tone="muted">
                  süre
                </AppText>
              </View>
              <View style={{ flex: 1, alignItems: 'center' }}>
                <AppText variant="subtitle">{card.week_active}</AppText>
                <AppText variant="caption" tone="muted">
                  aktif gün
                </AppText>
              </View>
            </View>
            {card.week_questions > 0 ? (
              <AppText variant="caption" tone="muted">
                Başarı %{Math.round((card.week_correct / card.week_questions) * 100)}
                {card.top_subject ? ` • En çok ${card.top_subject}` : ''}
              </AppText>
            ) : null}
          </View>
        </Card>
      ) : null}

      {subjectChips.length > 0 ? (
        <View style={{ gap: 8 }}>
          <AppText variant="label" tone="muted">
            Çalıştığı dersler
          </AppText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {subjectChips.map((subject) => (
              <View
                key={subject.id}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 8,
                  borderRadius: 999,
                  backgroundColor: colors.surface,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}>
                <AppText variant="caption">{subject.name}</AppText>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 8 }}>
        <AppText variant="label" tone="muted">
          Paylaşımları
        </AppText>
        {posts.map((post) => (
          <View
            key={post.id}
            style={{
              backgroundColor: colors.surface,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.border,
              padding: 14,
              gap: 6,
              shadowColor: '#142033',
              shadowOpacity: 0.05,
              shadowRadius: 8,
              shadowOffset: { width: 0, height: 3 },
              elevation: 1,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
              <AppText style={{ flex: 1 }}>{post.body}</AppText>
              {mine ? (
                <Pressable hitSlop={8} onPress={() => setPostMenu({ id: post.id, body: post.body })}>
                  <Ionicons name="ellipsis-horizontal" size={18} color={colors.textSubtle} />
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              {post.subject_name ? (
                <AppText variant="caption" tone="accent">
                  {post.subject_name}
                </AppText>
              ) : null}
              <AppText variant="caption" tone="muted">
                {postedAt(post.created_at)}
              </AppText>
              <AppText variant="caption" tone="muted">
                {post.like_count ?? 0} beğeni
              </AppText>
              <AppText variant="caption" tone="muted">
                {post.comment_count ?? 0} yorum
              </AppText>
            </View>
          </View>
        ))}
        {!cardQuery.isLoading && posts.length === 0 ? (
          <AppText tone="muted">Henüz paylaşım yok.</AppText>
        ) : null}
        {!showAllPosts && (card?.posts.length ?? 0) > 3 ? (
          <Pressable onPress={() => setShowAllPosts(true)}>
            <AppText variant="label" tone="accent">
              Tüm paylaşımları gör →
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <StudyInviteSheet
        visible={studyOpen}
        title="Birlikte çalış"
        subtitle="Ders ve konu seç, istek gitsin."
        subjects={subjectsQuery.data ?? []}
        topics={topicsQuery.data ?? []}
        pickedSubject={pickedSubject}
        pickedTopic={pickedTopic}
        onPickSubject={(value) => {
          setPickedSubject(value);
          setPickedTopic(null);
        }}
        onPickTopic={setPickedTopic}
        sending={requestStudy.isPending}
        onClose={() => setStudyOpen(false)}
        onSend={() => {
          if (!pickedSubject) return;
          void requestStudy
            .mutateAsync({
              otherId: id,
              subjectId: pickedSubject,
              topicId: pickedTopic,
              postId: params.postId ? String(params.postId) : null,
            })
            .then(() => setStudyOpen(false))
            .catch((error: unknown) => toastError(error));
        }}
      />
      <ActionSheet
        visible={profileMenu}
        title={name}
        onClose={() => setProfileMenu(false)}
        actions={[
          { key: 'report', icon: 'flag-outline', label: 'Şikayet et', onPress: () => setReportOpen(true) },
          {
            key: 'block',
            icon: 'ban-outline',
            label: 'Engelle',
            danger: true,
            onPress: () =>
              void blockUser.mutateAsync(id).then(
                () => {
                  if (!embedded) router.back();
                },
                (error: unknown) => toastError(error),
              ),
          },
        ]}
      />
      <ActionSheet
        visible={Boolean(postMenu)}
        title="Paylaşım"
        onClose={() => setPostMenu(null)}
        actions={[
          {
            key: 'edit',
            icon: 'create-outline',
            label: 'Düzenle',
            onPress: () => {
              if (postMenu) setEditPost(postMenu);
            },
          },
          {
            key: 'delete',
            icon: 'trash-outline',
            label: 'Sil',
            danger: true,
            onPress: () => {
              if (!postMenu) return;
              void removePost.mutateAsync(postMenu.id).then(
                () => cardQuery.refetch(),
                (error: unknown) => toastError(error),
              );
            },
          },
        ]}
      />

      <EditPostSheet
        visible={Boolean(editPost)}
        initial={editPost?.body ?? ''}
        onClose={() => setEditPost(null)}
        onSave={(body) => {
          if (!editPost) return;
          if (isBlockedRoomMessage(body)) {
            toastInfo('Bu içerik topluluk kurallarına uygun değil.');
            return;
          }
          void updatePost.mutateAsync({ postId: editPost.id, body }).then(
            () => {
              setEditPost(null);
              void cardQuery.refetch();
            },
            (error: unknown) => toastError(error),
          );
        }}
      />
      <ReportSheet
        visible={reportOpen}
        title="Kullanıcıyı şikayet et"
        onClose={() => setReportOpen(false)}
        onSubmit={(reason) => {
          setReportOpen(false);
          void reportUser.mutateAsync({ otherId: id, reason }).then(
            () => toastSuccess('Şikayetin alındı.'),
            (error: unknown) => toastError(error),
          );
        }}
      />
    </View>
  );

  if (embedded) return inner;
  return <Screen scroll>{inner}</Screen>;
}
