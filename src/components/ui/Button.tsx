import * as Haptics from 'expo-haptics';
import {
  ActivityIndicator,
  Pressable,
  type PressableProps,
  StyleSheet,
  View,
} from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { AppText } from './AppText';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = PressableProps & {
  label: string;
  loading?: boolean;
  variant?: Variant;
};

export function Button({ label, loading, variant = 'primary', disabled, onPress, ...rest }: Props) {
  const { colors, radius } = useAppTheme();

  const background = {
    primary: colors.accent,
    secondary: colors.surfaceMuted,
    ghost: 'transparent',
    danger: colors.danger,
  }[variant];

  const textTone = variant === 'primary' || variant === 'danger' ? 'inverse' : 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={(event) => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        onPress?.(event);
      }}
      style={({ pressed }) => [
        styles.base,
        {
          backgroundColor: background,
          borderRadius: radius.md,
          borderWidth: variant === 'ghost' ? 1 : 0,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.86 : 1,
        },
      ]}
      {...rest}>
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? colors.text : colors.accentText} />
        ) : (
          <AppText variant="subtitle" tone={textTone}>
            {label}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
