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
type Size = 'sm' | 'md' | 'lg';

type Props = PressableProps & {
  label: string;
  loading?: boolean;
  variant?: Variant;
  size?: Size;
};

export function Button({ label, loading, variant = 'primary', size = 'md', disabled, onPress, ...rest }: Props) {
  const { colors, radius } = useAppTheme();

  const background = {
    primary: colors.accent,
    secondary: colors.surfaceElevated,
    ghost: 'transparent',
    danger: colors.danger,
  }[variant];

  const textTone = variant === 'primary' || variant === 'danger' ? 'inverse' : 'primary';
  const minHeight = size === 'sm' ? 40 : size === 'lg' ? 52 : 46;
  const padX = size === 'sm' ? 14 : 18;

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
          minHeight,
          paddingHorizontal: padX,
          backgroundColor: background,
          borderRadius: radius.md,
          borderWidth: variant === 'ghost' || variant === 'secondary' ? 1 : 0,
          borderColor: colors.border,
          opacity: disabled ? 0.5 : pressed ? 0.86 : 1,
        },
      ]}
      {...rest}>
      <View style={styles.row}>
        {loading ? (
          <ActivityIndicator color={variant === 'secondary' || variant === 'ghost' ? colors.text : colors.accentText} />
        ) : (
          <AppText variant={size === 'sm' ? 'label' : 'subtitle'} tone={textTone}>
            {label}
          </AppText>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
