import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Alert, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { ChatActionSheet } from '@/src/features/social/ChatActionSheet';
import { ChatComposer } from '@/src/features/social/ChatComposer';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { ReactionBar } from '@/src/features/social/ReactionBar';
import { ReportSheet } from '@/src/features/social/ReportSheet';
import { postedAt } from '@/src/features/social/identity';
import { useMessageReactions } from '@/src/features/social/useMessageReactions';
import { useBlockUser, useReportContent } from '@/src/features/social/useSocial';
import { useStudyRoomMessages, type StudyRoomMessage } from '@/src/features/study/useStudyTogether';
import { isBlockedRoomMessage } from '@/src/lib/moderation/profanity';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

export function RoomChat({
  sessionId,
  me,
  members,
}: {
  sessionId: string;
  me?: string;
  members: { user_id: string; display_name: string }[];
}) {
  const { colors } = useAppTheme();
  const chat = useStudyRoomMessages(sessionId);
  const report = useReportContent();
  const blockUser = useBlockUser();
  const [draft, setDraft] = useState('');
  const [reportFor, setReportFor] = useState<StudyRoomMessage | null>(null);
  const [menu, setMenu] = useState<StudyRoomMessage | null>(null);
  const messageIds = useMemo(() => (chat.data ?? []).map((item) => item.id), [chat.data]);
  const reactions = useMessageReactions('room', messageIds);

  const nameOf = (userId: string) => {
    if (userId === me) return 'Sen';
    return members.find((item) => item.user_id === userId)?.display_name ?? 'Öğrenci';
  };

  const react = (messageId: string, emoji: string) => {
    void reactions.toggle.mutateAsync({ messageId, emoji }).catch((error: unknown) =>
      toastError(error),
    );
  };

  const onSend = () => {
    const body = draft.trim();
    if (!body || chat.send.isPending) return;
    if (isBlockedRoomMessage(body)) {
      toastInfo('Bu içerik topluluk kurallarına uygun değil.');
      return;
    }
    void chat.send.mutateAsync(body).then(
      () => setDraft(''),
      (error: unknown) => toastError(error),
    );
  };

  return (
    <View style={{ gap: 8, marginTop: 8 }}>
      <AppText variant="label" tone="accent">
        ODA SOHBETİ
      </AppText>
      {(chat.data ?? []).map((message) => {
        const mine = message.sender_id === me;
        return (
          <Pressable
            key={message.id}
            onLongPress={() => setMenu(message)}
            delayLongPress={280}
            style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
            <LetterAvatar id={message.sender_id} name={nameOf(message.sender_id)} size={32} />
            <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <AppText variant="caption" style={{ fontWeight: '700' }} numberOfLines={1}>
                  {nameOf(message.sender_id)}
                </AppText>
                <AppText variant="caption" tone="subtle">
                  {postedAt(message.created_at)}
                </AppText>
                {mine ? null : (
                  <Pressable onPress={() => setMenu(message)} hitSlop={8} style={{ marginLeft: 'auto', padding: 4 }}>
                    <Ionicons name="ellipsis-horizontal" size={16} color={colors.textMuted} />
                  </Pressable>
                )}
              </View>
              <AppText style={{ lineHeight: 20 }}>{message.body}</AppText>
              <ReactionBar items={reactions.grouped.get(message.id) ?? []} onPress={(emoji) => react(message.id, emoji)} />
            </View>
          </Pressable>
        );
      })}
      <ChatComposer
        draft={draft}
        onChangeDraft={setDraft}
        placeholder="Yaz"
        sending={chat.send.isPending}
        onSend={onSend}
        bottomPad={8}
        showAttach={false}
      />
      <ChatActionSheet
        visible={Boolean(menu)}
        title={menu ? nameOf(menu.sender_id) : undefined}
        onClose={() => setMenu(null)}
        onReact={(emoji) => {
          if (!menu) return;
          react(menu.id, emoji);
        }}
        actions={
          menu && menu.sender_id !== me
            ? [
                { key: 'report', icon: 'flag-outline', label: 'Şikayet et', onPress: () => setReportFor(menu) },
                {
                  key: 'block',
                  icon: 'ban-outline',
                  label: 'Engelle',
                  danger: true,
                  onPress: () =>
                    void blockUser.mutateAsync(menu.sender_id).then(
                      () => toastSuccess('Kullanıcı engellendi.'),
                      (error: unknown) => toastError(error),
                    ),
                },
              ]
            : [{ key: 'cancel', icon: 'close-outline', label: 'Kapat', onPress: () => undefined }]
        }
      />
      <ReportSheet
        visible={Boolean(reportFor)}
        title="Gönderiyi şikayet et"
        onClose={() => setReportFor(null)}
        onSubmit={(reason) => {
          const message = reportFor;
          setReportFor(null);
          if (!message) return;
          void report.mutateAsync({ type: 'room_message', contentId: message.id, reason }).then(
            () => toastSuccess('Şikayetin alındı.'),
            (error: unknown) => toastError(error),
          );
        }}
      />
    </View>
  );
}
