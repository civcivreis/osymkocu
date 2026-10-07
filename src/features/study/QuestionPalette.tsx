import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export type PaletteItem = {
  id: string;
  answered?: boolean;
  marked?: boolean;
};

export function QuestionPalette({
  items,
  current,
  onSelect,
}: {
  items: PaletteItem[];
  current: number;
  onSelect: (index: number) => void;
}) {
  const { colors } = useAppTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {items.map((item, index) => {
        const active = index === current;
        return (
          <Pressable
            key={item.id}
            onPress={() => onSelect(index)}
            style={{
              width: 32,
              height: 32,
              borderRadius: 8,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: active
                ? colors.accent
                : item.marked
                  ? colors.warning
                  : item.answered
                    ? colors.accentMuted
                    : colors.bgMuted,
            }}>
            <AppText variant="caption" tone={active ? 'inverse' : 'primary'} style={{ fontWeight: '700' }}>
              {index + 1}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
