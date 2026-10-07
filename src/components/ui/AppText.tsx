import { Text, type TextProps, type TextStyle } from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Variant = 'display' | 'title' | 'subtitle' | 'body' | 'caption' | 'label';

const styles: Record<Variant, TextStyle> = {
  display: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6 },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  subtitle: { fontSize: 17, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 0.2 },
};

type Props = TextProps & {
  variant?: Variant;
  tone?: 'primary' | 'muted' | 'subtle' | 'accent' | 'danger' | 'inverse';
};

export function AppText({ variant = 'body', tone = 'primary', style, ...rest }: Props) {
  const { colors } = useAppTheme();
  const colorMap = {
    primary: colors.text,
    muted: colors.textMuted,
    subtle: colors.textSubtle,
    accent: colors.accent,
    danger: colors.danger,
    inverse: colors.accentText,
  };

  return <Text style={[styles[variant], { color: colorMap[tone] }, style]} {...rest} />;
}
