import { Pressable, View } from 'react-native';

import { ActionSheet, type ActionSheetItem } from '@/src/components/ui/ActionSheet';
import { AppText } from '@/src/components/ui/AppText';
import { REACTION_EMOJIS } from '@/src/features/social/emojiCatalog';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export type ChatSheetAction = ActionSheetItem;

export function ChatActionSheet({
  visible,
  title,
  actions,
  onClose,
  onReact,
}: {
  visible: boolean;
  title?: string;
  actions: ChatSheetAction[];
  onClose: () => void;
  onReact?: (emoji: string) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <ActionSheet
      visible={visible}
      title={title}
      actions={actions}
      onClose={onClose}
      header={
        onReact ? (
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
            {REACTION_EMOJIS.map((emoji) => (
              <Pressable
                key={emoji}
                onPress={() => {
                  onClose();
                  onReact(emoji);
                }}
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.bg,
                }}>
                <AppText style={{ fontSize: 22, lineHeight: 28 }}>{emoji}</AppText>
              </Pressable>
            ))}
          </View>
        ) : undefined
      }
    />
  );
}
