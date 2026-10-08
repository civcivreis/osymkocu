import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { ChatImageThumb } from '@/src/features/social/ChatImage';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { ReactionBar } from '@/src/features/social/ReactionBar';
import { clockLabel } from '@/src/features/social/identity';
import type { ReactionSummary } from '@/src/features/social/useMessageReactions';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function ChatBubble({
  mine,
  name,
  body,
  time,
  avatarId,
  showAvatar,
  showHeader,
  showUsername,
  tight,
  replyName,
  replyBody,
  imageUrl,
  imageWidth,
  imageHeight,
  mediaId,
  reactions,
  onPressName,
  onLongPress,
  onPressImage,
  onPressReaction,
}: {
  mine: boolean;
  name: string;
  body: string;
  time?: string | null;
  avatarId: string;
  showAvatar: boolean;
  showHeader: boolean;
  showUsername?: boolean;
  tight?: boolean;
  replyName?: string | null;
  replyBody?: string | null;
  imageUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  mediaId?: string | null;
  reactions?: ReactionSummary[];
  onPressName?: () => void;
  onLongPress?: () => void;
  onPressImage?: () => void;
  onPressReaction?: (emoji: string) => void;
}) {
  const { colors } = useAppTheme();
  const caption = body.trim();
  const hasImage = Boolean(mediaId || imageUrl);

  return (
    <Pressable
      onLongPress={onLongPress}
      delayLongPress={280}
      style={{
        flexDirection: 'row',
        justifyContent: mine ? 'flex-end' : 'flex-start',
        alignItems: 'flex-end',
        gap: 8,
        marginTop: tight ? 2 : 12,
      }}>
      {mine ? null : showAvatar ? (
        <Pressable onPress={onPressName} hitSlop={6}>
          <LetterAvatar id={avatarId} name={name} size={28} />
        </Pressable>
      ) : (
        <View style={{ width: 28 }} />
      )}
      <View style={{ maxWidth: '78%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
        {showHeader ? (
          <Pressable
            onPress={onPressName}
            hitSlop={4}
            style={{ marginBottom: 4, flexDirection: 'row', gap: 6, alignItems: 'center' }}>
            {!mine && showUsername ? (
              <AppText variant="caption" style={{ fontWeight: '700' }}>
                {name}
              </AppText>
            ) : null}
            <AppText variant="caption" tone="subtle">
              {clockLabel(time)}
            </AppText>
          </Pressable>
        ) : null}
        <View
          style={{
            paddingVertical: hasImage ? 6 : 9,
            paddingHorizontal: hasImage ? 6 : 12,
            borderRadius: 18,
            borderBottomRightRadius: mine ? 6 : 18,
            borderBottomLeftRadius: mine ? 18 : 6,
            backgroundColor: mine ? colors.accent : colors.surface,
            borderWidth: mine ? 0 : 1,
            borderColor: colors.border,
            overflow: 'hidden',
          }}>
          {replyBody ? (
            <View
              style={{
                marginBottom: 6,
                marginHorizontal: hasImage ? 6 : 0,
                paddingLeft: 8,
                borderLeftWidth: 2,
                borderLeftColor: mine ? 'rgba(255,255,255,0.45)' : colors.accent,
                opacity: 0.9,
              }}>
              <AppText
                variant="caption"
                tone={mine ? 'inverse' : 'accent'}
                numberOfLines={1}
                style={{ fontWeight: '700' }}>
                {replyName ?? 'Mesaj'}
              </AppText>
              <AppText variant="caption" tone={mine ? 'inverse' : 'muted'} numberOfLines={2}>
                {replyBody}
              </AppText>
            </View>
          ) : null}
          {hasImage ? (
            <ChatImageThumb
              mediaId={mediaId}
              uri={imageUrl}
              width={imageWidth}
              height={imageHeight}
              mine={mine}
              onPress={onPressImage}
            />
          ) : null}
          {caption ? (
            <AppText
              tone={mine ? 'inverse' : 'primary'}
              style={{
                fontSize: 15,
                lineHeight: 21,
                marginTop: hasImage ? 6 : 0,
                marginHorizontal: hasImage ? 6 : 0,
                marginBottom: hasImage ? 2 : 0,
              }}>
              {caption}
            </AppText>
          ) : null}
        </View>
        <ReactionBar items={reactions ?? []} align={mine ? 'right' : 'left'} onPress={onPressReaction} />
      </View>
    </Pressable>
  );
}
