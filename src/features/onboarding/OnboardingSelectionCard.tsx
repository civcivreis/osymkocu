import { Ionicons } from '@expo/vector-icons';
import { useState, type ComponentProps, type ReactNode } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Accent = 'orange' | 'weak' | 'strong';

type Props = {
  title: string;
  subtitle?: string;
  selected?: boolean;
  icon?: ComponentProps<typeof Ionicons>['name'];
  check?: boolean;
  accent?: Accent;
  minHeight?: number;
  children?: ReactNode;
  onPress: () => void;
};

export function OnboardingSelectionCard({
  title,
  subtitle,
  selected,
  icon,
  check = true,
  accent = 'orange',
  minHeight = 108,
  children,
  onPress,
}: Props) {
  const { colors, radius, shadows, scheme } = useAppTheme();
  const [hovered, setHovered] = useState(false);
  const palette = accentColors(accent, colors, scheme);
  const border = selected ? palette.border : colors.border;
  const background = selected ? palette.bg : colors.surfaceElevated;
  const scaled = hovered && Platform.OS === 'web' && !selected;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: Boolean(selected) }}
      onPress={onPress}
      {...({
        onHoverIn: () => setHovered(true),
        onHoverOut: () => setHovered(false),
      } as object)}
      style={({ pressed }) => ({
        minHeight,
        flexGrow: 1,
        paddingVertical: 16,
        paddingHorizontal: 16,
        borderRadius: radius[16],
        borderWidth: selected ? 2 : 1,
        borderColor: border,
        backgroundColor: background,
        transform: [{ scale: pressed ? 0.98 : scaled ? 1.015 : 1 }],
        ...(hovered || selected ? shadows.sm : null),
      })}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12, flex: 1 }}>
        {icon ? (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: selected ? palette.iconBg : colors.surfaceMuted,
            }}>
            <Ionicons name={icon} size={20} color={selected ? palette.icon : colors.navy} />
          </View>
        ) : null}
        <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
          <AppText variant="subtitle" numberOfLines={2} style={{ color: selected ? palette.title : colors.text }}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" tone="muted" numberOfLines={3}>
              {subtitle}
            </AppText>
          ) : null}
          {children}
        </View>
        {check && selected ? (
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.border,
            }}>
            <Ionicons name="checkmark" size={14} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

function accentColors(
  accent: Accent,
  colors: ReturnType<typeof useAppTheme>['colors'],
  scheme: ReturnType<typeof useAppTheme>['scheme'],
) {
  const dark = scheme === 'dark';
  if (accent === 'weak') {
    return {
      border: colors.danger,
      bg: dark ? '#3A221F' : '#FBECEA',
      icon: colors.danger,
      iconBg: dark ? '#4A2A26' : '#F8D7D3',
      title: colors.text,
    };
  }
  if (accent === 'strong') {
    return {
      border: colors.success,
      bg: dark ? '#163328' : '#E7F5EE',
      icon: colors.success,
      iconBg: dark ? '#1C4032' : '#D3EDE0',
      title: colors.text,
    };
  }
  return {
    border: colors.accent,
    bg: colors.accentMuted,
    icon: colors.accent,
    iconBg: dark ? '#4A3228' : '#F8E8DC',
    title: colors.text,
  };
}
