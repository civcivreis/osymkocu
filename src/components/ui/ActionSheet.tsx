import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  Animated,
  BackHandler,
  InteractionManager,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export type ActionSheetItem = {
  key: string;
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
  hint?: string;
  danger?: boolean;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  onPress: () => void;
};

export function ActionSheet({
  visible,
  title,
  subtitle,
  header,
  actions,
  cancelLabel = 'Vazgeç',
  onClose,
  children,
}: {
  visible: boolean;
  title?: string;
  subtitle?: string;
  header?: ReactNode;
  actions: ActionSheetItem[];
  cancelLabel?: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const progress = useRef(new Animated.Value(0)).current;
  const queued = useRef<(() => void) | null>(null);
  const sheetRef = useRef<View>(null);

  const flush = () => {
    const next = queued.current;
    queued.current = null;
    if (!next) return;
    InteractionManager.runAfterInteractions(() => next());
  };

  const queueAndClose = (action?: () => void) => {
    queued.current = action ?? null;
    onClose();
  };

  useEffect(() => {
    Animated.timing(progress, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      useNativeDriver: true,
    }).start();
  }, [progress, visible]);

  useEffect(() => {
    if (visible) return undefined;
    const wait = Platform.OS === 'ios' ? 420 : 40;
    const timer = setTimeout(flush, wait);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [onClose, visible]);

  useEffect(() => {
    if (!visible || Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const node = sheetRef.current as unknown as HTMLElement | null;
    const focusable = () =>
      Array.from(
        node?.querySelectorAll?.('button, [tabindex]:not([tabindex="-1"])') ?? [],
      ) as HTMLElement[];
    const first = focusable()[0];
    first?.focus?.();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const current = document.activeElement as HTMLElement | null;
      const index = items.indexOf(current ?? items[0]);
      const next = event.shiftKey
        ? items[(index - 1 + items.length) % items.length]
        : items[(index + 1) % items.length];
      event.preventDefault();
      next.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, visible]);

  const web = Platform.OS === 'web';

  return (
    <Modal
      transparent
      animationType="none"
      visible={visible}
      onRequestClose={onClose}
      onDismiss={flush}
      statusBarTranslucent
      accessibilityViewIsModal>
      <View style={{ flex: 1, justifyContent: web ? 'center' : 'flex-end', paddingHorizontal: web ? 24 : 0 }}>
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            backgroundColor: 'rgba(20,32,51,0.38)',
            opacity: progress,
          }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Kapat"
            style={{ flex: 1 }}
            onPress={() => queueAndClose()}
          />
        </Animated.View>
        <Animated.View
          ref={sheetRef}
          accessibilityRole="menu"
          style={{
            backgroundColor: colors.surface,
            borderTopLeftRadius: web ? 22 : 26,
            borderTopRightRadius: web ? 22 : 26,
            borderBottomLeftRadius: web ? 22 : 0,
            borderBottomRightRadius: web ? 22 : 0,
            borderWidth: 1,
            borderColor: colors.border,
            paddingHorizontal: 18,
            paddingTop: 10,
            paddingBottom: web ? 16 : Math.max(insets.bottom, 12) + 8,
            maxHeight: web ? '78%' : '82%',
            width: web ? '100%' : undefined,
            maxWidth: web ? 420 : undefined,
            alignSelf: web ? 'center' : undefined,
            transform: [
              {
                translateY: progress.interpolate({
                  inputRange: [0, 1],
                  outputRange: [web ? 24 : 80, 0],
                }),
              },
            ],
          }}>
          {web ? null : (
            <View
              style={{
                alignSelf: 'center',
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: colors.border,
                marginBottom: 12,
              }}
            />
          )}
          {header}
          {title ? (
            <AppText variant="subtitle" style={{ marginBottom: subtitle ? 2 : 8 }}>
              {title}
            </AppText>
          ) : null}
          {subtitle ? (
            <AppText variant="caption" tone="muted" style={{ marginBottom: 10 }}>
              {subtitle}
            </AppText>
          ) : null}
          {children}
          <ScrollView keyboardShouldPersistTaps="handled" style={{ flexGrow: 0 }}>
            {actions.map((item) => {
              const destructive = item.variant === 'destructive' || item.danger;
              return (
                <Pressable
                  key={item.key}
                  disabled={item.disabled}
                  onPress={() => queueAndClose(item.onPress)}
                  accessibilityRole="button"
                  accessibilityLabel={item.label}
                  accessibilityState={{ disabled: Boolean(item.disabled) }}
                  style={{
                    minHeight: 52,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    paddingVertical: 8,
                    opacity: item.disabled ? 0.45 : 1,
                  }}>
                  {item.icon ? (
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: destructive ? 'rgba(180,35,24,0.08)' : colors.bgMuted,
                      }}>
                      <Ionicons name={item.icon} size={18} color={destructive ? colors.danger : colors.accent} />
                    </View>
                  ) : null}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <AppText style={{ fontWeight: '700', color: destructive ? colors.danger : colors.text }}>
                      {item.label}
                    </AppText>
                    {item.hint ? (
                      <AppText variant="caption" tone="muted">
                        {item.hint}
                      </AppText>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </ScrollView>
          <Pressable
            onPress={() => queueAndClose()}
            accessibilityRole="button"
            accessibilityLabel={cancelLabel}
            style={{
              minHeight: 48,
              marginTop: 8,
              borderRadius: 16,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.bgMuted,
            }}>
            <AppText variant="label">{cancelLabel}</AppText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
