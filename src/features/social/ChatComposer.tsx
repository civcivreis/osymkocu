import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  TextInput,
  View,
  type NativeSyntheticEvent,
  type TextInputSelectionChangeEventData,
} from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { ChatActionSheet } from '@/src/features/social/ChatActionSheet';
import { EmojiPickerPanel } from '@/src/features/social/EmojiPickerPanel';
import { insertAtCursor } from '@/src/features/social/insertAtCursor';
import { pickDeviceImage } from '@/src/features/media/pickDeviceImage';
import { useRecentEmojis } from '@/src/features/social/useRecentEmojis';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export type PendingChatImage = {
  uri: string;
  base64: string;
  width?: number;
  height?: number;
  mime?: string;
};

export function ChatComposer({
  draft,
  onChangeDraft,
  placeholder,
  disabled,
  sending,
  pending,
  onPending,
  onSend,
  bottomPad,
  showAttach = true,
}: {
  draft: string;
  onChangeDraft: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  sending?: boolean;
  pending?: PendingChatImage | null;
  onPending?: (next: PendingChatImage | null) => void;
  onSend: () => void;
  bottomPad: number;
  showAttach?: boolean;
}) {
  const { colors } = useAppTheme();
  const inputRef = useRef<TextInput>(null);
  const selection = useRef({ start: draft.length, end: draft.length });
  const [caret, setCaret] = useState<{ start: number; end: number } | undefined>();
  const [sheet, setSheet] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const recent = useRecentEmojis();
  const canSend = !disabled && !sending && Boolean(pending || draft.trim());

  const pick = async (camera: boolean) => {
    if (!camera) console.log('[gallery] tap received');
    const asset = await pickDeviceImage({
      source: camera ? 'camera' : 'library',
      quality: 0.82,
    });
    if (!asset) return;
    onPending?.(asset);
  };

  const onSelectionChange = (event: NativeSyntheticEvent<TextInputSelectionChangeEventData>) => {
    selection.current = event.nativeEvent.selection;
    if (caret) setCaret(undefined);
  };

  const insertEmoji = (emoji: string) => {
    const next = insertAtCursor(draft, emoji, selection.current.start, selection.current.end);
    onChangeDraft(next.text);
    selection.current = { start: next.cursor, end: next.cursor };
    setCaret({ start: next.cursor, end: next.cursor });
    recent.remember(emoji);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const iconBtn = {
    width: 44,
    height: 44,
    borderRadius: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.border,
  };

  return (
    <View
      style={{
        paddingHorizontal: 16,
        paddingTop: pending || emojiOpen ? 10 : 8,
        paddingBottom: bottomPad,
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        gap: 8,
      }}>
      {emojiOpen ? <EmojiPickerPanel recent={recent.items} onPick={insertEmoji} /> : null}
      {pending ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Image source={{ uri: pending.uri }} style={{ width: 56, height: 56, borderRadius: 12 }} />
          <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
            Fotoğraf eklendi. İstersen altyazı yaz.
          </AppText>
          <Pressable onPress={() => !sending && onPending?.(null)} hitSlop={8}>
            <Ionicons name="close-circle" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {showAttach ? (
          <Pressable
            onPress={() => !disabled && !sending && setSheet(true)}
            disabled={disabled || sending}
            style={[iconBtn, { opacity: disabled ? 0.45 : 1 }]}>
            <Ionicons name="add" size={22} color={colors.accent} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => {
            if (disabled) return;
            if (emojiOpen) {
              setEmojiOpen(false);
              return;
            }
            Keyboard.dismiss();
            setEmojiOpen(true);
          }}
          disabled={disabled}
          style={[iconBtn, { opacity: disabled ? 0.45 : 1, backgroundColor: emojiOpen ? colors.accentMuted : colors.bg }]}>
          <Ionicons name="happy-outline" size={22} color={colors.accent} />
        </Pressable>
        <TextInput
          ref={inputRef}
          value={draft}
          onChangeText={onChangeDraft}
          onSelectionChange={onSelectionChange}
          selection={caret}
          onFocus={() => setEmojiOpen(false)}
          placeholder={placeholder}
          editable={!disabled}
          placeholderTextColor={colors.textSubtle}
          style={{
            flex: 1,
            minHeight: 44,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 18,
            paddingHorizontal: 12,
            color: colors.text,
            backgroundColor: colors.bg,
            fontSize: 16,
          }}
        />
        <Pressable
          onPress={onSend}
          disabled={!canSend}
          style={{
            width: 44,
            height: 44,
            borderRadius: 18,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.accent,
            opacity: canSend ? 1 : 0.45,
          }}>
          {sending ? (
            <ActivityIndicator color={colors.accentText} />
          ) : (
            <Ionicons name="send" size={18} color={colors.accentText} />
          )}
        </Pressable>
      </View>
      {showAttach ? (
        <ChatActionSheet
          visible={sheet}
          title="Fotoğraf"
          onClose={() => setSheet(false)}
          actions={[
            { key: 'library', icon: 'image-outline', label: 'Fotoğraf seç', onPress: () => void pick(false) },
            { key: 'camera', icon: 'camera-outline', label: 'Kamera', onPress: () => void pick(true) },
            { key: 'cancel', icon: 'close-outline', label: 'Vazgeç', onPress: () => undefined },
          ]}
        />
      ) : null}
    </View>
  );
}
