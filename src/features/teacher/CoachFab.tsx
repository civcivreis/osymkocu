import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import {
  COACH_FAB_SIZE,
  clampY,
  edgeX,
  ratioFromY,
  snapSide,
  yFromRatio,
  yBounds,
} from '@/src/features/teacher/coachLayout';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

const DRAG_THRESHOLD = 8;

export function CoachFab({ bottomOffset }: { bottomOffset: number }) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { isDesktop } = useBreakpoint();
  const side = useCoachStore((s) => s.side);
  const yRatio = useCoachStore((s) => s.yRatio);
  const setDock = useCoachStore((s) => s.setDock);
  const open = useCoachStore((s) => s.open);
  const setOpen = useCoachStore((s) => s.setOpen);
  const helpOffer = useCoachStore((s) => s.helpOffer);
  const setHelpOffer = useCoachStore((s) => s.setHelpOffer);
  const locked = useCoachStore((s) => s.coachLocked);
  const restX = isDesktop ? width - COACH_FAB_SIZE - 24 : edgeX(side, width);
  const parkedY = yFromRatio(yRatio, height, insets.top, bottomOffset);
  const dockY = yBounds(height, insets.top, bottomOffset).maxY;
  const restY = open ? dockY : parkedY;
  const x = useRef(new Animated.Value(restX)).current;
  const y = useRef(new Animated.Value(parkedY)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const fade = useRef(new Animated.Value(1)).current;
  const drag = useRef({ active: false, moved: false, pageX: 0, pageY: 0, startX: restX, startY: parkedY });
  const live = useRef({ x: restX, y: parkedY });
  const [keyboardOpen, setKeyboardOpen] = useState(false);

  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => {
        setKeyboardOpen(true);
      },
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardOpen(false);
      },
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useEffect(() => {
    if (drag.current.active) return;
    live.current.x = restX;
    x.setValue(restX);
    Animated.spring(y, {
      toValue: restY,
      useNativeDriver: false,
      friction: 8,
      tension: 80,
    }).start(({ finished }) => {
      if (finished) live.current.y = restY;
    });
  }, [restX, restY, x, y]);

  useEffect(() => {
    Animated.timing(fade, {
      toValue: open ? 0 : 1,
      duration: open ? 180 : 160,
      useNativeDriver: true,
    }).start();
  }, [fade, open]);

  if (locked || (keyboardOpen && !open)) return null;

  const onGrant = (pageX: number, pageY: number) => {
    x.stopAnimation((value) => {
      live.current.x = value;
    });
    y.stopAnimation((value) => {
      live.current.y = value;
    });
    drag.current = {
      active: true,
      moved: false,
      pageX,
      pageY,
      startX: live.current.x,
      startY: live.current.y,
    };
  };

  const onMove = (pageX: number, pageY: number) => {
    if (open) return;
    const dx = pageX - drag.current.pageX;
    const dy = pageY - drag.current.pageY;
    if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
      if (!drag.current.moved) {
        drag.current.moved = true;
        Animated.spring(scale, { toValue: 1.08, useNativeDriver: true, friction: 7 }).start();
      }
    }
    if (!drag.current.moved) return;
    const nextX = Math.min(width - COACH_FAB_SIZE - 8, Math.max(8, drag.current.startX + dx));
    const nextY = clampY(drag.current.startY + dy, height, insets.top, bottomOffset);
    live.current = { x: nextX, y: nextY };
    x.setValue(nextX);
    y.setValue(nextY);
  };

  const onRelease = (canOpen: boolean) => {
    const moved = drag.current.moved;
    drag.current.active = false;
    Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7 }).start();
    if (!open && moved) {
      const nextSide = snapSide(live.current.x, width);
      const nextY = clampY(live.current.y, height, insets.top, bottomOffset);
      const targetX = edgeX(nextSide, width);
      live.current = { x: targetX, y: nextY };
      setDock(nextSide, ratioFromY(nextY, height, insets.top, bottomOffset));
      y.setValue(nextY);
      Animated.spring(x, {
        toValue: targetX,
        useNativeDriver: false,
        friction: 7,
        tension: 80,
      }).start();
      return;
    }
    if (!canOpen) return;
    if (keyboardOpen) return;
    setHelpOffer(false);
    setOpen(!open);
  };

  const onLeft = side === 'left';

  return (
    <Animated.View
      pointerEvents={open ? 'none' : 'box-none'}
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: COACH_FAB_SIZE,
        alignItems: onLeft ? 'flex-start' : 'flex-end',
        zIndex: 50,
      }}>
      {helpOffer && !open ? (
        <Pressable
          onPress={() => {
            setHelpOffer(false);
            setOpen(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Koça soru hakkında yardım iste"
          style={{
            position: 'absolute',
            bottom: COACH_FAB_SIZE + 8,
            left: onLeft ? 0 : undefined,
            right: onLeft ? undefined : 0,
            width: 228,
            backgroundColor: colors.surface,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: colors.border,
            shadowColor: '#142033',
            shadowOpacity: 0.12,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
            paddingHorizontal: 12,
            paddingVertical: 10,
            gap: 4,
          }}>
          <AppText variant="caption" style={{ fontWeight: '700' }}>
            Takıldın mı?
          </AppText>
          <AppText variant="caption" tone="muted">
            Bu soruyu bana sorabilirsin. İstersen küçük bir ipucu da verebilirim.
          </AppText>
        </Pressable>
      ) : null}
      <Animated.View
        accessible
        accessibilityRole="button"
        accessibilityLabel={open ? 'Koç sohbetini küçült' : 'Koç sohbetini aç'}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => !open}
        onResponderGrant={(evt) => onGrant(evt.nativeEvent.pageX, evt.nativeEvent.pageY)}
        onResponderMove={(evt) => onMove(evt.nativeEvent.pageX, evt.nativeEvent.pageY)}
        onResponderRelease={() => onRelease(true)}
        onResponderTerminate={() => onRelease(false)}
        style={{
          width: COACH_FAB_SIZE,
          height: COACH_FAB_SIZE,
          borderRadius: COACH_FAB_SIZE / 2,
          backgroundColor: colors.accent,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#142033',
          shadowOpacity: 0.2,
          shadowRadius: 12,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
          opacity: fade,
          transform: [{ scale }],
        }}>
        <Ionicons name="sparkles" size={24} color={colors.accentText} />
      </Animated.View>
    </Animated.View>
  );
}
