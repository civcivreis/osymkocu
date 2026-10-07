import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { nativeDriver } from '@/src/lib/animation/nativeDriver';
import { useReducedMotion } from '@/src/lib/animation/useReducedMotion';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Props = {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  primaryLabel: string;
  primaryLoading?: boolean;
  loadingLabel?: string;
  primaryDisabled?: boolean;
  showBack?: boolean;
  direction: 1 | -1;
  error?: string | null;
  onBack?: () => void;
  onPrimary: () => void;
};

export function OnboardingShell({
  step,
  total,
  title,
  subtitle,
  children,
  primaryLabel,
  primaryLoading,
  loadingLabel,
  primaryDisabled,
  showBack,
  direction,
  error,
  onBack,
  onPrimary,
}: Props) {
  const { colors, radius, shadows } = useAppTheme();
  const { width } = useBreakpoint();
  const reduced = useReducedMotion();
  const compact = width < 768;
  const pad = compact ? 16 : 24;
  const opacity = useRef(new Animated.Value(1)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const progress = useRef(new Animated.Value((step + 1) / total)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: (step + 1) / total,
      duration: reduced ? 0 : 220,
      useNativeDriver: false,
    }).start();
  }, [progress, reduced, step, total]);

  useEffect(() => {
    if (reduced) {
      opacity.setValue(1);
      slide.setValue(0);
      return;
    }
    opacity.setValue(0);
    slide.setValue(direction * 28);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: nativeDriver }),
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: nativeDriver }),
    ]).start();
  }, [direction, opacity, reduced, slide, step]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom']}>
      <View
        style={{
          flex: 1,
          width: '100%',
          maxWidth: 960,
          alignSelf: 'center',
          paddingHorizontal: pad,
          paddingTop: compact ? 8 : 20,
          paddingBottom: compact ? 12 : 20,
        }}>
        <View
          style={{
            flex: 1,
            backgroundColor: colors.surface,
            borderRadius: radius[20],
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: compact ? 16 : 28,
            paddingTop: compact ? 18 : 24,
            paddingBottom: compact ? 16 : 20,
            ...shadows.md,
          }}>
          <View style={{ gap: 10, marginBottom: 16 }}>
            <AppText variant="caption" tone="muted">
              Adım {step + 1} / {total}
            </AppText>
            <View
              style={{
                height: 8,
                borderRadius: 999,
                backgroundColor: colors.bgMuted,
                overflow: 'hidden',
              }}>
              <Animated.View
                style={{
                  height: '100%',
                  backgroundColor: colors.accent,
                  borderRadius: 999,
                  width: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ['0%', '100%'],
                  }),
                }}
              />
            </View>
          </View>

          <Animated.View style={{ flex: 1, opacity, transform: [{ translateX: slide }] }}>
            <ScrollView
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ gap: 16, paddingBottom: 12, flexGrow: 1 }}>
              <View style={{ gap: 6, maxWidth: 560 }}>
                <AppText variant="title">{title}</AppText>
                {subtitle ? (
                  <AppText tone="muted" style={{ maxWidth: 480 }}>
                    {subtitle}
                  </AppText>
                ) : null}
              </View>
              {children}
            </ScrollView>
          </Animated.View>

          <View style={{ gap: 10, paddingTop: 12 }}>
            {error ? (
              <AppText tone="danger" variant="caption" style={{ maxWidth: 520 }}>
                {error}
              </AppText>
            ) : null}
            <View style={{ flexDirection: compact ? 'column-reverse' : 'row', gap: 10 }}>
              {showBack ? (
                <View style={{ flex: compact ? undefined : 1 }}>
                  <Button label="Geri" variant="ghost" disabled={primaryLoading} onPress={onBack} />
                </View>
              ) : null}
              <View style={{ flex: compact ? undefined : showBack ? 1.45 : 1 }}>
                <Button
                  label={primaryLabel}
                  loading={primaryLoading}
                  loadingLabel={loadingLabel}
                  disabled={primaryDisabled}
                  onPress={onPrimary}
                />
              </View>
            </View>
          </View>
        </View>
        {Platform.OS === 'web' ? <View style={{ height: 8 }} /> : null}
      </View>
    </SafeAreaView>
  );
}

export function onboardingCardWidth(totalWidth: number, cols: number, gap = 12, compact = false) {
  const inner = Math.max(280, Math.min(904, totalWidth) - (compact ? 64 : 104));
  return Math.floor((inner - gap * (cols - 1)) / cols);
}
