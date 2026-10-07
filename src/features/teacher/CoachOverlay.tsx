import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import {
    Animated,
    Keyboard,
    Platform,
    Pressable,
    useWindowDimensions,
    View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { CoachPanel } from '@/src/features/teacher/CoachPanel';
import { COACH_PANEL_GUTTER, COACH_PANEL_MAX_WIDTH } from '@/src/features/teacher/coachLayout';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { AnalyticsProvider } from '@/src/lib/analytics/AnalyticsProvider';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function CoachOverlay({ bottomOffset }: { bottomOffset: number }) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { isDesktop } = useBreakpoint();
  const open = useCoachStore((s) => s.open);
  const setOpen = useCoachStore((s) => s.setOpen);
  const side = useCoachStore((s) => s.side);
  const progress = useRef(new Animated.Value(0)).current;
  const [shown, setShown] = useState(open);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    if (open) AnalyticsProvider.track('coach_opened');
  }, [open]);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (event) => setKeyboardHeight(event.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (open) setShown(true);
    Animated.spring(progress, {
      toValue: open ? 1 : 0,
      friction: 8,
      tension: 86,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished && !open) setShown(false);
    });
  }, [open, progress]);

  if (!shown) return null;

  const gutter = COACH_PANEL_GUTTER;
  const available = width - gutter * 2;
  const wide = available > COACH_PANEL_MAX_WIDTH;
  const panelWidth = isDesktop ? 400 : Math.min(available, COACH_PANEL_MAX_WIDTH);
  const dockedLeft = isDesktop ? false : !wide || side === 'left';

  return (
    <View
      pointerEvents="auto"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
        zIndex: 80,
      }}>
      <Animated.View
        pointerEvents="auto"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          backgroundColor: isDesktop ? 'transparent' : 'rgba(20,32,51,0.32)',
          opacity: progress,
        }}>
        {isDesktop ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Koç sohbetini kapat"
          onPress={() => setOpen(false)}
          style={{ flex: 1 }}
        />
        )}
      </Animated.View>
      <Animated.View
        pointerEvents="auto"
        style={{
          position: 'absolute',
          top: isDesktop ? 0 : insets.top + 8,
          bottom: isDesktop ? 0 : keyboardHeight > 0 ? keyboardHeight + 8 : bottomOffset + 10,
          left: dockedLeft ? gutter : undefined,
          right: dockedLeft ? (wide ? undefined : gutter) : isDesktop ? 0 : gutter,
          width: wide || isDesktop ? panelWidth : undefined,
          backgroundColor: colors.surface,
          borderRadius: isDesktop ? 0 : 24,
          borderWidth: 1,
          borderColor: colors.border,
          overflow: 'hidden',
          shadowColor: '#142033',
          shadowOpacity: 0.16,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 8 },
          elevation: 12,
          opacity: progress,
          transform: [
            {
              translateY: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [32, 0],
              }),
            },
            {
              scale: progress.interpolate({
                inputRange: [0, 1],
                outputRange: [0.98, 1],
              }),
            },
          ],
        }}>
        <View
          style={{
            height: 52,
            flexDirection: 'row',
            alignItems: 'center',
            paddingHorizontal: 8,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
            backgroundColor: colors.surface,
          }}>
          <AppText variant="subtitle" style={{ flex: 1, marginLeft: 8 }}>
            AI Koç
          </AppText>
          <Pressable
            onPress={() => setOpen(false)}
            accessibilityLabel="Küçült"
            hitSlop={10}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="remove" size={22} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => setOpen(false)}
            accessibilityLabel="Kapat"
            hitSlop={10}
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={22} color={colors.text} />
          </Pressable>
        </View>
        <View style={{ flex: 1, minHeight: 0 }}>
          <CoachPanel />
        </View>
      </Animated.View>
    </View>
  );
}
