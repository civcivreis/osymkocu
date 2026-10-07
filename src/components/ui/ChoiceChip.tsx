import { Pressable } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Props = {
  label: string;
  selected?: boolean;
  onPress: () => void;
};

export function ChoiceChip({ label, selected, onPress }: Props) {
  const { colors, radius } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 10,
        paddingHorizontal: 14,
        borderRadius: radius.pill,
        borderWidth: 1,
        borderColor: selected ? colors.accent : colors.border,
        backgroundColor: selected ? colors.accentMuted : colors.surface,
      }}>
      <AppText variant="caption" tone={selected ? 'accent' : 'muted'}>
        {label}
      </AppText>
    </Pressable>
  );
}
