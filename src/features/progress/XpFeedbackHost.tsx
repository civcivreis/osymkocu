import { useEffect } from 'react';
import { Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useXpFeedbackStore } from '@/src/features/progress/xpFeedbackStore';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function XpFeedbackHost() {
  const { colors } = useAppTheme();
  const toast = useXpFeedbackStore((s) => s.toast);
  const levelUp = useXpFeedbackStore((s) => s.levelUp);
  const clearToast = useXpFeedbackStore((s) => s.clearToast);
  const clearLevelUp = useXpFeedbackStore((s) => s.clearLevelUp);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(clearToast, 2400);
    return () => clearTimeout(timer);
  }, [clearToast, toast]);

  useEffect(() => {
    if (!levelUp) return undefined;
    const timer = setTimeout(clearLevelUp, 2800);
    return () => clearTimeout(timer);
  }, [clearLevelUp, levelUp]);

  if (!toast && !levelUp) return null;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 80 }}>
      {toast ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 56,
            alignSelf: 'center',
            backgroundColor: colors.navy,
            borderRadius: 16,
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 2,
            minWidth: 160,
            alignItems: 'center',
          }}>
          <AppText variant="label" tone="inverse">
            +{toast.xp} XP
          </AppText>
          <AppText variant="caption" style={{ color: '#F4F1EA' }}>
            {toast.title}
          </AppText>
        </View>
      ) : null}
      {levelUp ? (
        <Pressable
          onPress={clearLevelUp}
          style={{
            flex: 1,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(20,32,51,0.28)',
          }}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 22,
              paddingHorizontal: 28,
              paddingVertical: 18,
              alignItems: 'center',
              gap: 6,
              minWidth: 220,
            }}>
            <AppText variant="subtitle">Seviye {levelUp}’e ulaştın 🎉</AppText>
            <AppText variant="caption" tone="muted">
              Çalışmaya devam
            </AppText>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
