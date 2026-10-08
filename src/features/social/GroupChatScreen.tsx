import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Keyboard,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ActionSheet } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';
import { ChatDropZone } from '@/src/features/social/ChatDropZone';
import { askCoachFromChat } from '@/src/features/social/askCoachFromChat';
import { ChatActionSheet } from '@/src/features/social/ChatActionSheet';
import { ChatBubble } from '@/src/features/social/ChatBubble';
import { ChatComposer, type PendingChatImage } from '@/src/features/social/ChatComposer';
import { ChatImageViewer } from '@/src/features/social/ChatImage';
import { ReportSheet, IMAGE_REPORT_REASONS, REPORT_REASONS } from '@/src/features/social/ReportSheet';
import { groupActivityLine, taggedName } from '@/src/features/social/identity';
import { chatImageUrl, chatPreview, isImageMessage, sameCluster, uploadChatImage } from '@/src/features/social/chatMedia';
import { useInbox, useMarkThreadRead, useToggleThreadMute, useToggleThreadPin } from '@/src/features/social/useInbox';
import { useMessageReactions } from '@/src/features/social/useMessageReactions';
import {
  useBlockUser,
  useDeleteOwnChatMessage,
  useGroupMessages,
  useReportContent,
  useSendGroupMessage,
  type GroupMessage,
} from '@/src/features/social/useSocial';
import { isBlockedRoomMessage } from '@/src/lib/moderation/profanity';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export function GroupChatScreen({
  groupSlug,
  groupName,
  embedded,
}: {
  groupSlug?: string;
  groupName?: string;
  embedded?: boolean;
} = {}) {
  const { colors, spacing } = useAppTheme();
  const params = useLocalSearchParams<{ slug?: string; name?: string }>();
  const slug = String(groupSlug ?? params.slug ?? '');
  const name = String(groupName ?? params.name ?? 'Grup');
  const me = useAuthStore((s) => s.session?.user.id);
  const messagesQuery = useGroupMessages(slug || null);
  const send = useSendGroupMessage();
  const inbox = useInbox();
  const markRead = useMarkThreadRead();
  const pin = useToggleThreadPin();
  const mute = useToggleThreadMute();
  const report = useReportContent();
  const blockUser = useBlockUser();
  const remove = useDeleteOwnChatMessage();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingChatImage | null>(null);
  const [sendingImage, setSendingImage] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [reportFor, setReportFor] = useState<GroupMessage | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [menu, setMenu] = useState<GroupMessage | null>(null);
  const [viewer, setViewer] = useState<GroupMessage | null>(null);
  const [replyTo, setReplyTo] = useState<GroupMessage | null>(null);

  const group = inbox.data?.groups.find((item) => item.slug === slug);
  const reversed = useMemo(() => [...(messagesQuery.data ?? [])].reverse(), [messagesQuery.data]);
  const messageIds = useMemo(() => (messagesQuery.data ?? []).map((item) => item.id), [messagesQuery.data]);
  const reactions = useMessageReactions('group', messageIds);

  useEffect(() => {
    if (!slug) return;
    void getSupabase().rpc('join_exam_group', { p_slug: slug });
  }, [slug]);

  const markGroupRead = markRead.mutate;
  useFocusEffect(
    useCallback(() => {
      if (!slug) return undefined;
      markGroupRead({ kind: 'group', thread: slug });
      const tick = setInterval(() => {
        markGroupRead({ kind: 'group', thread: slug });
      }, 4000);
      return () => clearInterval(tick);
    }, [markGroupRead, slug]),
  );

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const canSend = Boolean(slug && (draft.trim() || pending) && !send.isPending && !sendingImage);

  const onSend = async () => {
    if (!canSend || !me) return;
    const body = draft.trim();
    if (!pending && isBlockedRoomMessage(body)) {
      toastInfo('Bu içerik topluluk kurallarına uygun değil.');
      return;
    }
    try {
      setSendingImage(Boolean(pending));
      let mediaId: string | undefined;
      let width = pending?.width;
      let height = pending?.height;
      if (pending) {
        const uploaded = await uploadChatImage({
          userId: me,
          base64: pending.base64,
          mime: pending.mime,
          width: pending.width,
          height: pending.height,
          groupSlug: slug,
        });
        mediaId = uploaded.mediaId;
        width = uploaded.width ?? width;
        height = uploaded.height ?? height;
      }
      await send.mutateAsync({
        slug,
        body,
        mediaId,
        width,
        height,
        replyTo: replyTo?.id,
      });
      setDraft('');
      setPending(null);
      setReplyTo(null);
      await messagesQuery.refetch();
      void markRead.mutateAsync({ kind: 'group', thread: slug });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Fotoğraf gönderilemedi';
      if (pending) {
        askConfirm({
          title: 'Fotoğraf gönderilemedi',
          subtitle: message,
          confirmLabel: 'Tekrar dene',
          onConfirm: () => void onSend(),
        });
      } else {
        toastError(message);
      }
    } finally {
      setSendingImage(false);
    }
  };

  const openActions = () => setHeaderMenu(true);

  const openMessageMenu = (item: GroupMessage) => {
    setMenu(item);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={embedded ? [] : ['top']}>
      <ChatDropZone onImage={setPending}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          paddingHorizontal: spacing.screen,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.surface,
        }}>
        {embedded ? null : (
        <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel="Geri">
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        )}
        <View style={{ flex: 1 }}>
          <AppText variant="subtitle">{name}</AppText>
          <AppText variant="caption" tone="muted">
            {groupActivityLine(group?.member_count ?? 0, group?.last_at)}
          </AppText>
        </View>
        <Pressable onPress={openActions} hitSlop={10}>
          <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
        </Pressable>
      </View>

      <FlatList
        inverted
        data={reversed}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingVertical: 12 }}
        style={{ flex: 1 }}
        initialNumToRender={12}
        windowSize={8}
        removeClippedSubviews
        keyboardShouldPersistTaps="handled"
        renderItem={({ item, index }) => {
          const mine = item.sender_id === me;
          const older = reversed[index + 1];
          const newer = reversed[index - 1];
          const showHeader = !mine && !sameCluster(older, item);
          const showAvatar = !mine && !sameCluster(newer, item);
          const tight = sameCluster(newer, item);
          const showImage = isImageMessage(item);
          const label = taggedName(item.display_name, item.display_tag);
          return (
            <ChatBubble
              mine={mine}
              name={label}
              body={item.body}
              time={item.created_at}
              avatarId={item.sender_id}
              showAvatar={showAvatar}
              showHeader={showHeader || (mine && !sameCluster(older, item))}
              showUsername={!mine}
              tight={tight}
              replyName={item.reply_name}
              replyBody={item.reply_body}
              mediaId={item.media_id}
              imageUrl={chatImageUrl(item.image_path)}
              imageWidth={item.image_width}
              imageHeight={item.image_height}
              onPressName={() => router.push({ pathname: '/user', params: { userId: item.sender_id } })}
              onLongPress={() => openMessageMenu(item)}
              onPressImage={showImage ? () => setViewer(item) : undefined}
              reactions={reactions.grouped.get(item.id)}
              onPressReaction={(emoji) =>
                void reactions.toggle.mutateAsync({ messageId: item.id, emoji }).catch((error: unknown) =>
                  toastError(error),
                )
              }
            />
          );
        }}
        ListEmptyComponent={
          <AppText tone="muted" style={{ transform: [{ scaleY: -1 }] }}>
            Gruba yaz. Mesajlar burada akar.
          </AppText>
        }
      />

      {replyTo ? (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            paddingHorizontal: spacing.screen,
            paddingTop: 8,
            backgroundColor: colors.surface,
          }}>
          <View style={{ flex: 1 }}>
            <AppText variant="caption" tone="accent">
              {taggedName(replyTo.display_name, replyTo.display_tag)} yanıtlanıyor
            </AppText>
            <AppText variant="caption" tone="muted" numberOfLines={1}>
              {chatPreview(replyTo) || replyTo.body}
            </AppText>
          </View>
          <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
            <Ionicons name="close" size={18} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      <ChatComposer
        draft={draft}
        onChangeDraft={setDraft}
        placeholder="Mesaj yaz..."
        sending={send.isPending || sendingImage}
        pending={pending}
        onPending={setPending}
        onSend={() => void onSend()}
        bottomPad={Platform.OS === 'ios' ? keyboardHeight || 12 : 12}
      />

      <ActionSheet
        visible={headerMenu}
        title={name}
        subtitle={groupActivityLine(group?.member_count ?? 0, group?.last_at)}
        onClose={() => setHeaderMenu(false)}
        actions={[
          {
            key: 'pin',
            icon: 'pin-outline',
            label: group?.is_pinned ? 'Sabiti kaldır' : 'Sabitle',
            onPress: () => void pin.mutateAsync({ kind: 'group', thread: slug }),
          },
          {
            key: 'mute',
            icon: 'notifications-off-outline',
            label: group?.is_muted ? 'Sesi aç' : 'Sessize al',
            onPress: () => void mute.mutateAsync({ kind: 'group', thread: slug }),
          },
        ]}
      />
      <ChatActionSheet
        visible={Boolean(menu)}
        title={menu ? taggedName(menu.display_name, menu.display_tag) : undefined}
        onClose={() => setMenu(null)}
        onReact={(emoji) => {
          if (!menu) return;
          void reactions.toggle.mutateAsync({ messageId: menu.id, emoji }).catch((error: unknown) =>
            toastError(error),
          );
        }}
        actions={
          menu
            ? [
                {
                  key: 'reply',
                  icon: 'arrow-undo-outline',
                  label: 'Yanıtla',
                  onPress: () => setReplyTo(menu),
                },
                ...(isImageMessage(menu)
                  ? [
                      {
                        key: 'coach',
                        icon: 'sparkles-outline' as const,
                        label: 'Koça sor',
                        onPress: () =>
                          void askCoachFromChat({
                            mediaId: menu.media_id,
                            imageUrl: chatImageUrl(menu.image_path),
                            caption: menu.body,
                            where: `${name} grubu`,
                          }),
                      },
                    ]
                  : []),
                ...(menu.sender_id === me
                  ? [
                      {
                        key: 'delete',
                        icon: 'trash-outline' as const,
                        label: 'Sil',
                        danger: true,
                        onPress: () =>
                          void remove.mutateAsync({ scope: 'group', id: menu.id }).catch((error: unknown) =>
                            toastError(error, 'Silinmedi'),
                          ),
                      },
                    ]
                  : [
                      {
                        key: 'report',
                        icon: 'flag-outline' as const,
                        label: 'Şikayet et',
                        onPress: () => setReportFor(menu),
                      },
                      {
                        key: 'block',
                        icon: 'ban-outline' as const,
                        label: 'Engelle',
                        danger: true,
                        onPress: () =>
                          void blockUser.mutateAsync(menu.sender_id).then(
                            () => toastSuccess('Kullanıcı engellendi.'),
                            (error: unknown) => toastError(error),
                          ),
                      },
                    ]),
              ]
            : []
        }
      />
      <ReportSheet
        visible={Boolean(reportFor)}
        title="Mesajı şikayet et"
        reasons={reportFor && isImageMessage(reportFor) ? IMAGE_REPORT_REASONS : REPORT_REASONS}
        onClose={() => setReportFor(null)}
        onSubmit={(reason) => {
          const target = reportFor;
          setReportFor(null);
          if (!target) return;
          void report.mutateAsync({ type: 'group_message', contentId: target.id, reason }).then(
            () => toastSuccess('Şikayetin alındı.'),
            (error: unknown) => toastError(error),
          );
        }}
      />
      <ChatImageViewer
        visible={Boolean(viewer)}
        mediaId={viewer?.media_id}
        uri={viewer ? chatImageUrl(viewer.image_path) : null}
        sender={viewer ? taggedName(viewer.display_name, viewer.display_tag) : undefined}
        time={viewer?.created_at}
        caption={viewer?.body}
        onClose={() => setViewer(null)}
      />
      </ChatDropZone>
    </SafeAreaView>
  );
}
