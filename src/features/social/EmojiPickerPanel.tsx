import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { EMOJI_CATEGORIES, QUICK_EMOJIS } from '@/src/features/social/emojiCatalog';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

function EmojiCell({ emoji, onPress }: { emoji: string; onPress: (emoji: string) => void }) {
  return (
    <Pressable
      onPress={() => onPress(emoji)}
      style={{
        width: 44,
        height: 44,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <AppText style={{ fontSize: 22, lineHeight: 28 }}>{emoji}</AppText>
    </Pressable>
  );
}

export function EmojiPickerPanel({
  recent,
  onPick,
}: {
  recent: string[];
  onPick: (emoji: string) => void;
}) {
  const { colors } = useAppTheme();
  const [category, setCategory] = useState(EMOJI_CATEGORIES[0]?.id ?? 'faces');
  const active = EMOJI_CATEGORIES.find((item) => item.id === category) ?? EMOJI_CATEGORIES[0];

  return (
    <View
      style={{
        borderRadius: 20,
        backgroundColor: colors.surface,
        borderWidth: 1,
        borderColor: colors.border,
        paddingVertical: 10,
        paddingHorizontal: 8,
        maxHeight: 280,
        shadowColor: '#142033',
        shadowOpacity: 0.12,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 8 },
        elevation: 6,
      }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 2, paddingHorizontal: 4 }}>
        {QUICK_EMOJIS.map((emoji) => (
          <EmojiCell key={`quick-${emoji}`} emoji={emoji} onPress={onPick} />
        ))}
      </ScrollView>
      {recent.length ? (
        <View style={{ marginTop: 6 }}>
          <AppText variant="caption" tone="muted" style={{ fontWeight: '700', paddingHorizontal: 8, marginBottom: 2 }}>
            Son kullanılanlar
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 4 }}>
            {recent.map((emoji) => (
              <EmojiCell key={`recent-${emoji}`} emoji={emoji} onPress={onPick} />
            ))}
          </ScrollView>
        </View>
      ) : null}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 6, paddingHorizontal: 6, paddingVertical: 8 }}>
        {EMOJI_CATEGORIES.map((item) => {
          const selected = item.id === category;
          return (
            <Pressable
              key={item.id}
              onPress={() => setCategory(item.id)}
              style={{
                minHeight: 32,
                paddingHorizontal: 10,
                borderRadius: 14,
                justifyContent: 'center',
                backgroundColor: selected ? colors.accentMuted : colors.bg,
                borderWidth: 1,
                borderColor: selected ? colors.accent : colors.border,
              }}>
              <AppText variant="caption" style={{ fontWeight: '700', color: selected ? colors.accent : colors.textMuted }}>
                {item.label}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
      <ScrollView style={{ maxHeight: 132 }} contentContainerStyle={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 2 }}>
        {(active?.emojis ?? []).map((emoji) => (
          <EmojiCell key={`${active?.id}-${emoji}`} emoji={emoji} onPress={onPick} />
        ))}
      </ScrollView>
    </View>
  );
}
