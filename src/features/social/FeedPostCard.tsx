import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { ActionSheet } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { Card } from '@/src/components/ui/Card';
import { CommentsSheet } from '@/src/features/social/CommentsSheet';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { EditPostSheet, ReportSheet } from '@/src/features/social/ReportSheet';
import { postedAt, subjectGlyph, taggedName } from '@/src/features/social/identity';
import {
  postAuthor,
  useBlockUser,
  useDeleteOwnPost,
  useReportContent,
  useTogglePostLike,
  useUpdateOwnPost,
  type PostComment,
  type SocialPost,
} from '@/src/features/social/useSocial';
import { useJoinExamLobby, useRequestStudy } from '@/src/features/study/useStudyTogether';
import { moderateContent } from '@/src/lib/moderation/profanity';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

export function FeedPostCard({ post, me }: { post: SocialPost; me?: string }) {
  const { colors } = useAppTheme();
  const joinExam = useJoinExamLobby();
  const like = useTogglePostLike();
  const study = useRequestStudy();
  const blockUser = useBlockUser();
  const remove = useDeleteOwnPost();
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [menuKind, setMenuKind] = useState<'own' | 'other' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const author = postAuthor(post);
  const name = taggedName(author?.display_name, author?.display_tag);
  const preview = (post.comment_preview ?? []).slice(0, 2);
  const extra = Math.max(0, (post.comment_count ?? 0) - preview.length);

  const goProfile = () =>
    router.push({
      pathname: '/user',
      params: { userId: post.user_id, postId: post.id, subjectId: post.subject_id ?? '' },
    });

  const mine = post.user_id === me;
  const showToast = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(null), 1800);
  };

  const openOwnMenu = () => setMenuKind('own');
  const openOtherMenu = () => setMenuKind('other');

  const menu = (
    <Pressable onPress={mine ? openOwnMenu : openOtherMenu} hitSlop={8} style={{ padding: 4 }}>
      <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
    </Pressable>
  );

  if (post.kind === 'exam_lobby' && post.session_id) {
    return (
      <View>
        <Card>
          <View style={{ gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Pressable onPress={goProfile} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <LetterAvatar id={post.user_id} name={author?.display_name} size={40} />
                <View style={{ flex: 1, gap: 2 }}>
                  <NameLine name={name} bot={post.is_bot} />
                  <AppText variant="caption" tone="muted">
                    Açık oda · {postedAt(post.created_at)}
                  </AppText>
                </View>
              </Pressable>
              {menu}
              <Pressable
                onPress={() =>
                  void joinExam.mutateAsync(post.session_id!).then(
                    () => router.push({ pathname: '/study-room', params: { sessionId: post.session_id! } }),
                    (error: unknown) => toastError(error),
                  )
                }
                style={{
                  minHeight: 32,
                  paddingHorizontal: 12,
                  borderRadius: 999,
                  justifyContent: 'center',
                  backgroundColor: colors.accentMuted,
                }}>
                <AppText variant="caption" tone="accent" style={{ fontWeight: '700' }}>
                  Katıl
                </AppText>
              </Pressable>
            </View>
            <AppText style={{ lineHeight: 22 }}>{post.body}</AppText>
          </View>
        </Card>
        <PostOverlays
          post={post}
          reportOpen={reportOpen}
          editOpen={editOpen}
          toast={toast}
          onCloseReport={() => setReportOpen(false)}
          onCloseEdit={() => setEditOpen(false)}
          onReported={() => showToast('Şikayetin alındı.')}
        />
        <FeedMenu
          kind={menuKind}
          onClose={() => setMenuKind(null)}
          onEdit={() => setEditOpen(true)}
          onDelete={() =>
            void remove.mutateAsync(post.id).then(
              () => showToast('Durum silindi.'),
              (error: unknown) => toastError(error),
            )
          }
          onReport={() => setReportOpen(true)}
          onBlock={() =>
            void blockUser.mutateAsync(post.user_id).then(
              () => showToast('Kullanıcı engellendi.'),
              (error: unknown) => toastError(error),
            )
          }
        />
      </View>
    );
  }

  return (
    <Card>
      <View style={{ gap: 12 }}>
        <Pressable onPress={goProfile} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <LetterAvatar id={post.user_id} name={author?.display_name} size={42} />
          <View style={{ flex: 1, gap: 2 }}>
            <NameLine name={name} bot={post.is_bot} />
            <AppText variant="caption" tone="muted">
              {[postedAt(post.created_at), post.subject_name ? `${subjectGlyph(post.subject_name)} ${post.subject_name}` : null, post.goal_label]
                .filter(Boolean)
                .join(' · ')}
            </AppText>
          </View>
          {menu}
        </Pressable>
        <AppText style={{ lineHeight: 24 }}>{post.body}</AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <IconAction
            icon={post.liked_by_me ? 'heart' : 'heart-outline'}
            count={post.like_count ?? 0}
            active={Boolean(post.liked_by_me)}
            onPress={() => void like.mutateAsync(post.id)}
          />
          <IconAction
            icon="chatbubble-outline"
            count={post.comment_count ?? 0}
            onPress={() => setCommentsOpen(true)}
          />
          {post.user_id !== me && post.subject_id ? (
            <Pressable
              onPress={() =>
                void study
                  .mutateAsync({ otherId: post.user_id, subjectId: post.subject_id!, postId: post.id })
                  .then(
                    () => toastSuccess('İstek gitti. Kabul ederse aynı derse geçersiniz.'),
                    (error: unknown) => toastError(error),
                  )
              }
              hitSlop={8}
              style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Ionicons name="people-outline" size={18} color={post.kind === 'ask' ? colors.accent : colors.textMuted} />
            </Pressable>
          ) : null}
        </View>
        {preview.length > 0 ? (
          <View style={{ gap: 10 }}>
            {preview.map((item) => (
              <PreviewLine key={item.id} item={item} />
            ))}
            {extra > 0 ? (
              <Pressable onPress={() => setCommentsOpen(true)} style={{ minHeight: 36, justifyContent: 'center' }}>
                <AppText variant="caption" tone="accent" style={{ fontWeight: '600' }}>
                  Tüm yorumları gör
                </AppText>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
      <CommentsSheet post={post} visible={commentsOpen} onClose={() => setCommentsOpen(false)} />
      <PostOverlays
        post={post}
        reportOpen={reportOpen}
        editOpen={editOpen}
        toast={toast}
        onCloseReport={() => setReportOpen(false)}
        onCloseEdit={() => setEditOpen(false)}
        onReported={() => showToast('Şikayetin alındı.')}
      />
      <FeedMenu
        kind={menuKind}
        onClose={() => setMenuKind(null)}
        onEdit={() => setEditOpen(true)}
        onDelete={() =>
          void remove.mutateAsync(post.id).then(
            () => showToast('Durum silindi.'),
            (error: unknown) => toastError(error),
          )
        }
        onReport={() => setReportOpen(true)}
        onBlock={() =>
          void blockUser.mutateAsync(post.user_id).then(
            () => showToast('Kullanıcı engellendi.'),
            (error: unknown) => toastError(error),
          )
        }
      />
    </Card>
  );
}

function FeedMenu({
  kind,
  onClose,
  onEdit,
  onDelete,
  onReport,
  onBlock,
}: {
  kind: 'own' | 'other' | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReport: () => void;
  onBlock: () => void;
}) {
  return (
    <ActionSheet
      visible={Boolean(kind)}
      title="Durum"
      onClose={onClose}
      actions={
        kind === 'own'
          ? [
              { key: 'edit', icon: 'create-outline', label: 'Düzenle', onPress: onEdit },
              { key: 'delete', icon: 'trash-outline', label: 'Sil', danger: true, onPress: onDelete },
            ]
          : [
              { key: 'report', icon: 'flag-outline', label: 'Şikayet et', onPress: onReport },
              { key: 'block', icon: 'ban-outline', label: 'Kullanıcıyı engelle', danger: true, onPress: onBlock },
            ]
      }
    />
  );
}

function PostOverlays({
  post,
  reportOpen,
  editOpen,
  toast,
  onCloseReport,
  onCloseEdit,
  onReported,
}: {
  post: SocialPost;
  reportOpen: boolean;
  editOpen: boolean;
  toast: string | null;
  onCloseReport: () => void;
  onCloseEdit: () => void;
  onReported: () => void;
}) {
  const { colors } = useAppTheme();
  const report = useReportContent();
  const update = useUpdateOwnPost();
  return (
    <>
      <ReportSheet
        visible={reportOpen}
        title="Gönderiyi şikayet et"
        onClose={onCloseReport}
        onSubmit={(reason) => {
          onCloseReport();
          void report.mutateAsync({ type: 'status', contentId: post.id, reason }).then(
            onReported,
            (error: unknown) => toastError(error),
          );
        }}
      />
      <EditPostSheet
        visible={editOpen}
        initial={post.body}
        onClose={onCloseEdit}
        onSave={(body) => {
          if (moderateContent(body) === 'block') {
            toastInfo('Bu içerik topluluk kurallarına uygun değil.');
            return;
          }
          onCloseEdit();
          void update.mutateAsync({ postId: post.id, body }).then(
            undefined,
            (error: unknown) => toastError(error),
          );
        }}
      />
      {toast ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            bottom: 10,
            alignSelf: 'center',
            backgroundColor: colors.navy,
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 12,
          }}>
          <AppText variant="caption" tone="inverse">
            {toast}
          </AppText>
        </View>
      ) : null}
    </>
  );
}

function NameLine({ name, bot }: { name: string; bot?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <AppText variant="subtitle">{name}</AppText>
      {bot ? (
        <AppText variant="caption" tone="muted">
          otomatik
        </AppText>
      ) : null}
    </View>
  );
}

function PreviewLine({ item }: { item: PostComment }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
      <LetterAvatar id={item.user_id} name={item.display_name} size={22} />
      <AppText variant="caption" style={{ flex: 1, lineHeight: 18 }}>
        <AppText variant="caption" style={{ fontWeight: '700' }}>
          {taggedName(item.display_name, item.display_tag)}
        </AppText>{' '}
        {item.body}
      </AppText>
    </View>
  );
}

function IconAction({
  icon,
  count,
  active,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  count: number;
  active?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={{
        minHeight: 44,
        minWidth: 44,
        paddingHorizontal: 6,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 4,
      }}>
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.textMuted} />
      {count > 0 ? (
        <AppText variant="caption" tone={active ? 'accent' : 'muted'}>
          {count}
        </AppText>
      ) : null}
    </Pressable>
  );
}
