import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { postedAt, taggedName } from '@/src/features/social/identity';
import {
  useAddPostComment,
  usePostComments,
  useToggleCommentLike,
  type PostComment,
  type SocialPost,
} from '@/src/features/social/useSocial';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

const PAGE = 10;

export function CommentsSheet({
  post,
  visible,
  onClose,
}: {
  post: SocialPost | null;
  visible: boolean;
  onClose: () => void;
}) {
  const { colors, spacing } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const me = useAuthStore((s) => s.session?.user.id);
  const comments = usePostComments(visible && post ? post.id : null);
  const send = useAddPostComment();
  const like = useToggleCommentLike();
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<PostComment | null>(null);
  const [page, setPage] = useState(PAGE);

  const roots = useMemo(() => {
    const rows = (comments.data ?? []).filter((item) => !item.parent_id);
    return rows;
  }, [comments.data]);
  const repliesOf = (id: string) => (comments.data ?? []).filter((item) => item.parent_id === id);
  const visibleRoots = roots.slice(0, page);
  const author = post ? taggedName(post.display_name, post.display_tag) : '';

  const onSend = () => {
    const body = draft.trim();
    if (!post || !body || send.isPending) return;
    void send
      .mutateAsync({ postId: post.id, body, parentId: replyTo?.id ?? null })
      .then(
        () => {
          setDraft('');
          setReplyTo(null);
        },
        (error: unknown) => toastError(error),
      );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: colors.overlay }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View
          style={{
            height: Math.round(height * 0.86),
            backgroundColor: colors.bg,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            overflow: 'hidden',
          }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: spacing.screen,
              paddingTop: 16,
              paddingBottom: 10,
              gap: 12,
            }}>
            <View style={{ flex: 1 }}>
              <AppText variant="title">Yorumlar</AppText>
              {post ? (
                <AppText variant="caption" tone="muted" numberOfLines={2} style={{ marginTop: 4 }}>
                  {author}: {post.body}
                </AppText>
              ) : null}
            </View>
            <Pressable
              onPress={onClose}
              hitSlop={8}
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: colors.surfaceMuted,
              }}>
              <Ionicons name="close" size={18} color={colors.text} />
            </Pressable>
          </View>

          <FlatList
            data={visibleRoots}
            keyExtractor={(item) => item.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingBottom: 16, gap: 16 }}
            ListEmptyComponent={
              <AppText tone="muted" style={{ paddingTop: 20 }}>
                İlk yorumu sen yaz.
              </AppText>
            }
            ListFooterComponent={
              roots.length > page ? (
                <Pressable onPress={() => setPage((n) => n + PAGE)} style={{ minHeight: 44, justifyContent: 'center' }}>
                  <AppText tone="accent">Daha fazla yorum</AppText>
                </Pressable>
              ) : null
            }
            renderItem={({ item }) => (
              <CommentBlock
                item={item}
                replies={repliesOf(item.id)}
                me={me}
                onReply={(row) => {
                  setReplyTo(row);
                  setDraft(`@${taggedName(row.display_name, row.display_tag)} `);
                }}
                onLike={(id) => void like.mutateAsync(id)}
              />
            )}
          />

          <View
            style={{
              borderTopWidth: 1,
              borderTopColor: colors.border,
              paddingHorizontal: spacing.screen,
              paddingTop: 10,
              paddingBottom: Math.max(insets.bottom, 12),
              backgroundColor: colors.surface,
              gap: 8,
            }}>
            {replyTo ? (
              <Pressable onPress={() => setReplyTo(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AppText variant="caption" tone="accent">
                  {taggedName(replyTo.display_name, replyTo.display_tag)} yanıtlanıyor
                </AppText>
                <Ionicons name="close" size={14} color={colors.accent} />
              </Pressable>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder={replyTo ? 'Yanıt yaz' : 'Yorum yaz'}
                placeholderTextColor={colors.textSubtle}
                style={{
                  flex: 1,
                  minHeight: 44,
                  borderRadius: 16,
                  paddingHorizontal: 14,
                  color: colors.text,
                  backgroundColor: colors.bgMuted,
                }}
              />
              <Pressable
                onPress={onSend}
                disabled={!draft.trim() || send.isPending}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.accent,
                  opacity: draft.trim() ? 1 : 0.4,
                }}>
                <Ionicons name="send" size={16} color={colors.accentText} />
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function CommentBlock({
  item,
  replies,
  me,
  onReply,
  onLike,
}: {
  item: PostComment;
  replies: PostComment[];
  me?: string;
  onReply: (row: PostComment) => void;
  onLike: (id: string) => void;
}) {
  return (
    <View style={{ gap: 12 }}>
      <CommentRow item={item} me={me} onReply={onReply} onLike={onLike} />
      {replies.map((reply) => (
        <View key={reply.id} style={{ marginLeft: 36 }}>
          <CommentRow item={reply} me={me} onReply={() => onReply(item)} onLike={onLike} />
        </View>
      ))}
    </View>
  );
}

function CommentRow({
  item,
  me,
  onReply,
  onLike,
}: {
  item: PostComment;
  me?: string;
  onReply: (row: PostComment) => void;
  onLike: (id: string) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
      <LetterAvatar id={item.user_id} name={item.display_name} size={30} />
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <AppText variant="caption" style={{ fontWeight: '700' }}>
            {taggedName(item.display_name, item.display_tag)}
          </AppText>
          <AppText variant="caption" tone="subtle">
            {postedAt(item.created_at)}
          </AppText>
        </View>
        <AppText variant="caption" style={{ lineHeight: 20, fontSize: 15 }}>
          {item.body}
        </AppText>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 32 }}>
          <Pressable onPress={() => onReply(item)} hitSlop={8}>
            <AppText variant="caption" tone="muted" style={{ fontWeight: '600' }}>
              Yanıtla
            </AppText>
          </Pressable>
          <Pressable onPress={() => onLike(item.id)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons
              name={item.liked_by_me ? 'heart' : 'heart-outline'}
              size={14}
              color={item.liked_by_me ? colors.accent : colors.textMuted}
            />
            {(item.like_count ?? 0) > 0 ? (
              <AppText variant="caption" tone={item.liked_by_me ? 'accent' : 'muted'}>
                {item.like_count}
              </AppText>
            ) : null}
          </Pressable>
        </View>
      </View>
    </View>
  );
}
