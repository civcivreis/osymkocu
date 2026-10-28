import { useEffect } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function CoachEventCard({
  title,
  body,
  pause,
  onDismiss,
}: {
  title: string;
  body: string;
  pause?: boolean;
  onDismiss: () => void;
}) {
  const { colors, radius } = useAppTheme();
  useEffect(() => {
    if (pause) return undefined;
    const t = setTimeout(onDismiss, 3200);
    return () => clearTimeout(t);
  }, [onDismiss, pause]);
  return (
    <View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 12,
        right: 12,
        top: 12,
        zIndex: 8,
        borderRadius: radius.lg,
        backgroundColor: 'rgba(15,28,46,0.94)',
        padding: 14,
        gap: 8,
      }}>
      <AppText variant="caption" style={{ color: '#E07A3D', fontWeight: '800', letterSpacing: 0.6 }}>
        {title}
      </AppText>
      <AppText style={{ color: '#FFFFFF', fontWeight: '700' }}>{body}</AppText>
      <Pressable
        onPress={onDismiss}
        style={{
          alignSelf: 'flex-start',
          minHeight: 40,
          paddingHorizontal: 14,
          borderRadius: 12,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <AppText tone="inverse">{pause ? 'Anladım' : 'Tamam'}</AppText>
      </Pressable>
    </View>
  );
}
