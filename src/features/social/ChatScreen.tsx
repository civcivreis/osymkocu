import { Ionicons } from '@expo/vector-icons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { ActionSheet } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { askConfirm, toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';
import { ChatDropZone } from '@/src/features/social/ChatDropZone';
import { askCoachFromChat } from '@/src/features/social/askCoachFromChat';
import { ChatActionSheet } from '@/src/features/social/ChatActionSheet';
import { ChatBubble } from '@/src/features/social/ChatBubble';
import { ChatComposer, type PendingChatImage } from '@/src/features/social/ChatComposer';
import { ChatImageViewer } from '@/src/features/social/ChatImage';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { taggedName } from '@/src/features/social/identity';
import { chatImageUrl, isImageMessage, sameCluster, uploadChatImage } from '@/src/features/social/chatMedia';
import { ReportSheet, IMAGE_REPORT_REASONS, REPORT_REASONS } from '@/src/features/social/ReportSheet';
import { useInbox, useMarkThreadRead, useToggleThreadMute, useToggleThreadPin } from '@/src/features/social/useInbox';
import { useMessageReactions } from '@/src/features/social/useMessageReactions';
import {
  useAcceptDm,
  useBlockUser,
  useConversationWith,
  useDeleteOwnChatMessage,
  useMessages,
  usePublicProfile,
  useReportContent,
  useSendDm,
  type DmMessage,
} from '@/src/features/social/useSocial';
import { isBlockedRoomMessage } from '@/src/lib/moderation/profanity';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

type ChatRow =
  | { type: 'day'; id: string; label: string }
  | { type: 'msg'; message: DmMessage };

function dayStamp(iso: string) {
  const date = new Date(iso);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dayLabel(iso: string) {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const that = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'Bugün';
  if (diff === 1) return 'Dün';
  return date.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
}

function buildRows(messages: DmMessage[]): ChatRow[] {
  const chronological: ChatRow[] = [];
  let lastDay = '';
  for (const message of messages) {
    const day = dayStamp(message.created_at);
    if (day !== lastDay) {
      chronological.push({ type: 'day', id: `day-${day}`, label: dayLabel(message.created_at) });
      lastDay = day;
    }
    chronological.push({ type: 'msg', message });
  }
  return chronological.reverse();
}

function presenceLine(
  incoming: boolean,
  waiting: boolean,
  lastFromThem?: string | null,
) {
  if (incoming) return 'İlk mesaj · kabul edersen devam eder';
  if (waiting) return 'Kabul bekleniyor';
  if (!lastFromThem) return 'Özel mesaj';
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(lastFromThem)) / 60000));
  if (!Number.isFinite(mins)) return 'Özel mesaj';
  if (mins <= 8) return 'Az önce aktif';
  if (mins < 60) return `Son görülme ${mins} dk önce`;
  if (mins < 24 * 60) return `Son görülme ${Math.round(mins / 60)} sa önce`;
  return 'Özel mesaj';
}

export function ChatScreen({
  peerId,
  embedded,
}: {
  peerId?: string;
  embedded?: boolean;
} = {}) {
  const { colors, spacing } = useAppTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ userId?: string; name?: string }>();
  const otherId = String(peerId ?? params.userId ?? '');
  const other = usePublicProfile(otherId || null);
  const name = taggedName(other.data?.display_name ?? params.name, other.data?.display_tag);
  const me = useAuthStore((s) => s.session?.user.id);
  const conversationQuery = useConversationWith(otherId || null);
  const conversation = conversationQuery.data;
  const messagesQuery = useMessages(conversation?.id ?? null);
  const send = useSendDm();
  const accept = useAcceptDm();
  const report = useReportContent();
  const blockUser = useBlockUser();
  const remove = useDeleteOwnChatMessage();
  const inbox = useInbox();
  const markRead = useMarkThreadRead();
  const pin = useToggleThreadPin();
  const mute = useToggleThreadMute();
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<PendingChatImage | null>(null);
  const [sendingImage, setSendingImage] = useState(false);
  const [viewer, setViewer] = useState<DmMessage | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [menu, setMenu] = useState<DmMessage | null>(null);
  const [reportFor, setReportFor] = useState<DmMessage | null>(null);
  const thread = conversation?.id ?? '';
  const dmMeta = inbox.data?.dms.find((item) => item.conversation_id === thread);
  const markDm = markRead.mutate;
  const messages = messagesQuery.data ?? [];

  useFocusEffect(
    useCallback(() => {
      if (!thread) return undefined;
      markDm({ kind: 'dm', thread });
      const tick = setInterval(() => markDm({ kind: 'dm', thread }), 4000);
      return () => clearInterval(tick);
    }, [markDm, thread]),
  );

  const waiting = Boolean(conversation && !conversation.accepted_at && conversation.initiated_by === me);
  const incoming = Boolean(conversation && !conversation.accepted_at && conversation.initiated_by !== me);
  const canSend = Boolean(otherId && (draft.trim() || pending) && !send.isPending && !sendingImage && !waiting);
  const rows = useMemo(() => buildRows(messages), [messages]);
  const messageIds = useMemo(() => messages.map((item) => item.id), [messages]);
  const reactions = useMessageReactions('dm', messageIds);
  const lastFromThem = [...messages].reverse().find((item) => item.sender_id !== me)?.created_at ?? null;
  const empty = messages.length === 0;

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
          conversationId: conversation?.id,
          otherUserId: otherId,
        });
        mediaId = uploaded.mediaId;
        width = uploaded.width ?? width;
        height = uploaded.height ?? height;
      }
      await send.mutateAsync({
        otherId,
        body,
        mediaId,
        width,
        height,
      });
      setDraft('');
      setPending(null);
      await conversationQuery.refetch();
      await messagesQuery.refetch();
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

  const composerPad = embedded ? 10 : Math.max(insets.bottom, 10);

  const header = (
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
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          )}
          <Pressable
            onPress={() => {
              if (otherId) router.push({ pathname: '/user', params: { userId: otherId } });
            }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 }}
            hitSlop={6}>
            {otherId ? <LetterAvatar id={otherId} name={other.data?.display_name ?? name} size={40} /> : null}
            <View style={{ flex: 1 }}>
              <AppText variant="subtitle" numberOfLines={1}>
                {name}
              </AppText>
              <AppText variant="caption" tone="muted" numberOfLines={1}>
                {presenceLine(incoming, waiting, lastFromThem)}
              </AppText>
            </View>
          </Pressable>
          <Pressable onPress={openActions} hitSlop={10}>
            <Ionicons name="ellipsis-horizontal" size={22} color={colors.text} />
          </Pressable>
        </View>
  );

  const body = (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={0}>
        {incoming && conversation ? (
          <View
            style={{
              marginHorizontal: spacing.screen,
              marginTop: 12,
              padding: 14,
              borderRadius: 18,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              gap: 10,
            }}>
            <AppText variant="caption" tone="muted">
              Bu kişi sana yazdı. Kabul edersen sohbet açılır.
            </AppText>
            <Button
              label="Mesajı kabul et"
              loading={accept.isPending}
              onPress={() => void accept.mutateAsync(conversation.id)}
            />
          </View>
        ) : null}

        {empty ? (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 8 }}>
            <AppText variant="subtitle" style={{ textAlign: 'center' }}>
              Henüz mesaj yok.
            </AppText>
            <AppText tone="muted" style={{ textAlign: 'center' }}>
              İlk mesajı sen gönder.
            </AppText>
            <AppText variant="caption" tone="subtle" style={{ textAlign: 'center', marginTop: 6 }}>
              Karşı taraf cevap verdiğinde veya mesaj isteğini kabul ettiğinde sohbet açılır.
            </AppText>
          </View>
        ) : (
          <FlatList
            inverted
            data={rows}
            keyExtractor={(item) => (item.type === 'day' ? item.id : item.message.id)}
            contentContainerStyle={{ paddingHorizontal: spacing.screen, paddingVertical: 10 }}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            windowSize={8}
            removeClippedSubviews
            renderItem={({ item, index }) => {
              if (item.type === 'day') {
                return (
                  <View style={{ alignItems: 'center', paddingVertical: 10 }}>
                    <View
                      style={{
                        paddingHorizontal: 10,
                        paddingVertical: 4,
                        borderRadius: 999,
                        backgroundColor: colors.bgMuted,
                      }}>
                      <AppText variant="caption" tone="muted">
                        {item.label}
                      </AppText>
                    </View>
                  </View>
                );
              }
              const mine = item.message.sender_id === me;
              const newer = rows[index - 1];
              const older = rows[index + 1];
              const newerMsg = newer?.type === 'msg' ? newer.message : null;
              const olderMsg = older?.type === 'msg' ? older.message : null;
              const tight = sameCluster(newerMsg, item.message);
              const showHeader = !sameCluster(olderMsg, item.message);
              const showAvatar = !mine && !sameCluster(newerMsg, item.message);
              const showImage = isImageMessage(item.message);
              return (
                <ChatBubble
                  mine={mine}
                  name={mine ? 'Sen' : name}
                  body={item.message.body}
                  time={item.message.created_at}
                  avatarId={item.message.sender_id}
                  showAvatar={showAvatar}
                  showHeader={showHeader}
                  showUsername={false}
                  tight={tight}
                  mediaId={item.message.media_id}
                  imageUrl={chatImageUrl(item.message.image_path)}
                  imageWidth={item.message.image_width}
                  imageHeight={item.message.image_height}
                  onLongPress={() => setMenu(item.message)}
                  onPressImage={showImage ? () => setViewer(item.message) : undefined}
                  reactions={reactions.grouped.get(item.message.id)}
                  onPressReaction={(emoji) =>
                    void reactions.toggle.mutateAsync({ messageId: item.message.id, emoji }).catch((error: unknown) =>
                      toastError(error),
                    )
                  }
                />
              );
            }}
          />
        )}

        {waiting && !empty ? (
          <View
            style={{
              marginHorizontal: spacing.screen,
              marginBottom: 8,
              paddingHorizontal: 12,
              paddingVertical: 10,
              borderRadius: 16,
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
            }}>
            <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
              Karşı taraf kabul edene kadar ikinci mesaj gönderemezsin.
            </AppText>
          </View>
        ) : null}

        <ChatComposer
          draft={draft}
          onChangeDraft={setDraft}
          placeholder={waiting ? 'Kabul bekleniyor' : 'Mesaj yaz...'}
          disabled={waiting}
          sending={send.isPending || sendingImage}
          pending={pending}
          onPending={setPending}
          onSend={() => void onSend()}
          bottomPad={composerPad}
        />
        <ChatActionSheet
          visible={Boolean(menu)}
          title={menu ? (menu.sender_id === me ? 'Mesajın' : name) : undefined}
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
                              where: 'Özel mesaj',
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
                            void remove.mutateAsync({ scope: 'dm', id: menu.id }).catch((error: unknown) =>
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
            void report.mutateAsync({ type: 'dm_message', contentId: target.id, reason }).then(
              () => undefined,
              (error: unknown) => toastError(error),
            );
          }}
        />
        <ChatImageViewer
          visible={Boolean(viewer)}
          mediaId={viewer?.media_id}
          uri={viewer ? chatImageUrl(viewer.image_path) : null}
          sender={viewer?.sender_id === me ? 'Sen' : name}
          time={viewer?.created_at}
          caption={viewer?.body}
          onClose={() => setViewer(null)}
        />
        <ActionSheet
          visible={headerMenu}
          title={name}
          onClose={() => setHeaderMenu(false)}
          actions={[
            {
              key: 'profile',
              icon: 'person-outline',
              label: 'Profil',
              onPress: () => router.push({ pathname: '/user', params: { userId: otherId } }),
            },
            ...(thread
              ? [
                  {
                    key: 'pin',
                    icon: 'pin-outline' as const,
                    label: dmMeta?.is_pinned ? 'Sabiti kaldır' : 'Sabitle',
                    onPress: () => void pin.mutateAsync({ kind: 'dm', thread }),
                  },
                  {
                    key: 'mute',
                    icon: 'notifications-off-outline' as const,
                    label: dmMeta?.is_muted ? 'Sesi aç' : 'Sessize al',
                    onPress: () => void mute.mutateAsync({ kind: 'dm', thread }),
                  },
                ]
              : []),
          ]}
        />
      </KeyboardAvoidingView>
  );

  if (embedded) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.bg }}>
        <ChatDropZone onImage={setPending}>
          {header}
          {body}
        </ChatDropZone>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top']}>
      <ChatDropZone onImage={setPending}>
        {header}
        {body}
      </ChatDropZone>
    </SafeAreaView>
  );
}
