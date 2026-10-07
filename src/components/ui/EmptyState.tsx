import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode } from 'react';
import { View } from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { AppText } from './AppText';
import { Button } from './Button';

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  body,
  actionLabel,
  onAction,
  children,
}: {
  icon?: ComponentProps<typeof Ionicons>['name'];
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  const { colors, spacing, radius } = useAppTheme();
  return (
    <View style={{ alignItems: 'center', gap: spacing[12], paddingVertical: spacing[24] }}>
      <View
        style={{
          width: 48,
          height: 48,
          borderRadius: radius.md,
          backgroundColor: colors.accentMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <Ionicons name={icon} size={22} color={colors.accent} />
      </View>
      <AppText variant="subtitle" style={{ textAlign: 'center' }}>
        {title}
      </AppText>
      {body ? (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center', maxWidth: 320 }}>
          {body}
        </AppText>
      ) : null}
      {actionLabel && onAction ? <Button label={actionLabel} size="sm" onPress={onAction} /> : null}
      {children}
    </View>
  );
}
