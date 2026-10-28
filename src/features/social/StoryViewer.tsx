import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { IMAGE_REPORT_REASONS, type ReportReasonId } from '@/src/features/social/ReportSheet';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { postedAt, taggedName } from '@/src/features/social/identity';
import type { StoryItem } from '@/src/features/social/useSocial';
import { nativeDriver } from '@/src/lib/animation/nativeDriver';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

const STORY_MS = 5000;
const TAP_ZONE = 0.32;

type Overlay = 'none' | 'menu' | 'delete' | 'report';

export function StoryViewer({
  visible,
  stories,
  startId,
  onClose,
  onDelete,
  onReport,
}: {
  visible: boolean;
  stories: StoryItem[];
  startId: string | null;
  onClose: () => void;
  onDelete: (id: string) => Promise<void>;
  onReport: (story: StoryItem, reason: ReportReasonId) => Promise<void>;
}) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const me = useAuthStore((s) => s.session?.user.id);
  const fill = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(0)).current;
  const dismiss = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  const remaining = useRef(STORY_MS);
  const runStarted = useRef(0);
  const paused = useRef(false);
  const loading = useRef(true);
  const indexRef = useRef(0);
  const overlayRef = useRef<Overlay>('none');
  const [index, setIndex] = useState(0);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  const ordered = useMemo(() => {
    const groups = new Map<string, StoryItem[]>();
    const order: string[] = [];
    for (const item of stories) {
      if (!groups.has(item.user_id)) {
        groups.set(item.user_id, []);
        order.push(item.user_id);
      }
      groups.get(item.user_id)!.push(item);
    }
    return order.flatMap((id) =>
      [...(groups.get(id) ?? [])].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)),
    );
  }, [stories]);

  const current = ordered[index] ?? null;
  const mine = Boolean(current && me && current.user_id === me);
  const userStories = ordered.filter((item) => item.user_id === current?.user_id);
  const userIndex = userStories.findIndex((item) => item.id === current?.id);

  overlayRef.current = overlay;
  indexRef.current = index;

  const stopFill = useCallback(() => {
    anim.current?.stop();
    anim.current = null;
    if (runStarted.current) {
      remaining.current = Math.max(0, remaining.current - (Date.now() - runStarted.current));
      runStarted.current = 0;
    }
  }, []);

  const playFill = useCallback(() => {
    if (!visible || paused.current || loading.current || overlayRef.current !== 'none') return;
    fill.setValue(1 - remaining.current / STORY_MS);
    runStarted.current = Date.now();
    anim.current = Animated.timing(fill, {
      toValue: 1,
      duration: remaining.current,
      useNativeDriver: false,
    });
    anim.current.start(({ finished }) => {
      if (!finished) return;
      remaining.current = 0;
      runStarted.current = 0;
      goNextRef.current();
    });
  }, [fill, visible]);

  const pause = useCallback(() => {
    paused.current = true;
    stopFill();
  }, [stopFill]);

  const resume = useCallback(() => {
    paused.current = overlayRef.current !== 'none';
    if (!paused.current) playFill();
  }, [playFill]);

  const resetFill = useCallback(() => {
    stopFill();
    remaining.current = STORY_MS;
    fill.setValue(0);
  }, [fill, stopFill]);

  const animateTo = useCallback(
    (dir: 1 | -1, then: () => void) => {
      slide.setValue(0);
      Animated.timing(slide, {
        toValue: dir * -width,
        duration: 240,
        useNativeDriver: nativeDriver,
      }).start(() => {
        then();
        slide.setValue(dir * width * 0.22);
        Animated.timing(slide, {
          toValue: 0,
          duration: 220,
          useNativeDriver: nativeDriver,
        }).start();
      });
    },
    [slide, width],
  );

  const closeViewer = useCallback(() => {
    stopFill();
    Animated.timing(dismiss, {
      toValue: 1,
      duration: 180,
      useNativeDriver: nativeDriver,
    }).start(() => {
      dismiss.setValue(0);
      onClose();
    });
  }, [dismiss, onClose, stopFill]);

  const lastNav = useRef(0);
  const canNav = () => {
    const now = Date.now();
    if (now - lastNav.current < 260) return false;
    lastNav.current = now;
    return true;
  };

  const goNext = useCallback(() => {
    if (!canNav()) return;
    const i = indexRef.current;
    if (i >= ordered.length - 1) {
      closeViewer();
      return;
    }
    animateTo(1, () => {
      resetFill();
      loading.current = true;
      setReady(false);
      setIndex(i + 1);
    });
  }, [animateTo, closeViewer, ordered.length, resetFill]);

  const goPrev = useCallback(() => {
    if (!canNav()) return;
    const i = indexRef.current;
    if (i <= 0) {
      resetFill();
      playFill();
      return;
    }
    animateTo(-1, () => {
      resetFill();
      loading.current = true;
      setReady(false);
      setIndex(i - 1);
    });
  }, [animateTo, playFill, resetFill]);

  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  useEffect(() => {
    if (!visible) {
      stopFill();
      setOverlay('none');
      setBusy(false);
      setReady(false);
      loading.current = true;
      return;
    }
    const start = ordered.findIndex((item) => item.id === startId);
    setIndex(start < 0 ? 0 : start);
    resetFill();
    loading.current = true;
    setReady(false);
    dismiss.setValue(0);
    slide.setValue(0);
  }, [dismiss, resetFill, slide, startId, stopFill, visible]);

  useEffect(() => {
    if (!visible) return;
    if (!ordered.length) {
      onClose();
      return;
    }
    setIndex((currentIndex) => Math.min(currentIndex, ordered.length - 1));
  }, [onClose, ordered.length, visible]);

  useEffect(() => {
    if (!visible || !ready || overlay !== 'none') return;
    loading.current = false;
    paused.current = false;
    playFill();
    return () => stopFill();
  }, [index, overlay, playFill, ready, stopFill, visible]);

  const onMediaReady = () => {
    loading.current = false;
    setReady(true);
  };

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setTimeout(() => {
      loading.current = false;
      setReady(true);
    }, 1400);
    return () => clearTimeout(timer);
  }, [index, visible]);

  const openOverlay = (next: Overlay) => {
    pause();
    setOverlay(next);
  };

  const closeOverlay = () => {
    setOverlay('none');
    paused.current = false;
    playFill();
  };

  const dragX = useRef(0);
  const dragY = useRef(0);
  const grantedAt = useRef(0);
  const holding = useRef(false);

  const headerBottom = Math.max(insets.top, 12) + 86;
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (evt) =>
          overlayRef.current === 'none' && evt.nativeEvent.pageY > headerBottom,
        onMoveShouldSetPanResponder: (evt, g) =>
          overlayRef.current === 'none' &&
          evt.nativeEvent.pageY > headerBottom &&
          (Math.abs(g.dx) > 8 || Math.abs(g.dy) > 8),
        onPanResponderGrant: () => {
          grantedAt.current = Date.now();
          holding.current = false;
          dragX.current = 0;
          dragY.current = 0;
          if (holdTimer.current) clearTimeout(holdTimer.current);
          holdTimer.current = setTimeout(() => {
            holding.current = true;
            pause();
          }, 180);
        },
        onPanResponderMove: (_e, g) => {
          dragX.current = g.dx;
          dragY.current = g.dy;
          if (Math.abs(g.dx) > 12 || Math.abs(g.dy) > 12) {
            if (holdTimer.current) {
              clearTimeout(holdTimer.current);
              holdTimer.current = null;
            }
          }
          if (g.dy > 12 && g.dy > Math.abs(g.dx)) {
            dismiss.setValue(Math.min(1, g.dy / 280));
          } else if (Math.abs(g.dx) > 12) {
            slide.setValue(g.dx);
          }
        },
        onPanResponderRelease: (_e, g) => {
          if (holdTimer.current) {
            clearTimeout(holdTimer.current);
            holdTimer.current = null;
          }
          const held = holding.current;
          holding.current = false;
          const x = g.moveX || g.x0;
          if (held) {
            dismiss.setValue(0);
            slide.setValue(0);
            resume();
            return;
          }
          if (g.dy > 90 && g.dy > Math.abs(g.dx)) {
            closeViewer();
            return;
          }
          if (g.dx < -56) {
            slide.setValue(0);
            dismiss.setValue(0);
            goNext();
            return;
          }
          if (g.dx > 56) {
            slide.setValue(0);
            dismiss.setValue(0);
            goPrev();
            return;
          }
          Animated.parallel([
            Animated.timing(slide, { toValue: 0, duration: 160, useNativeDriver: nativeDriver }),
            Animated.timing(dismiss, { toValue: 0, duration: 160, useNativeDriver: nativeDriver }),
          ]).start();
          if (Math.abs(g.dx) < 12 && Math.abs(g.dy) < 12) {
            if (x < width * TAP_ZONE) goPrev();
            else goNext();
          }
        },
        onPanResponderTerminate: () => {
          if (holdTimer.current) {
            clearTimeout(holdTimer.current);
            holdTimer.current = null;
          }
          holding.current = false;
          slide.setValue(0);
          dismiss.setValue(0);
          resume();
        },
      }),
    [closeViewer, dismiss, goNext, goPrev, headerBottom, pause, resume, slide, width],
  );

  const confirmDelete = async () => {
    if (!current) return;
    setBusy(true);
    try {
      const deletingId = current.id;
      const remaining = ordered.filter((item) => item.id !== deletingId);
      const nextItem = ordered.find((item, i) => i > index && item.id !== deletingId) ?? remaining[0] ?? null;
      await onDelete(deletingId);
      setOverlay('none');
      if (!nextItem) {
        closeViewer();
        return;
      }
      resetFill();
      loading.current = true;
      setReady(false);
      setIndex(Math.max(0, remaining.findIndex((item) => item.id === nextItem.id)));
    } finally {
      setBusy(false);
    }
  };

  const submitReport = async (reason: ReportReasonId) => {
    if (!current) return;
    setBusy(true);
    try {
      await onReport(current, reason);
      setOverlay('none');
      paused.current = false;
      playFill();
    } catch {
      /* toast is handled by the rail */
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={closeViewer}>
      <Animated.View
        style={{
          flex: 1,
          backgroundColor: '#0E1520',
          opacity: dismiss.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }),
          transform: [
            {
              translateY: dismiss.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.12] }),
            },
          ],
        }}>
        {current ? (
          <Animated.View style={{ flex: 1, transform: [{ translateX: slide }] }} {...pan.panHandlers}>
            <StoryMedia item={current} onReady={onMediaReady} />
            {!ready ? (
              <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                <ActivityIndicator color="#F4F1EA" />
              </View>
            ) : null}

            {Platform.OS === 'web' ? (
              <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: headerBottom, bottom: 0, flexDirection: 'row' }}>
                <Pressable accessibilityLabel="Önceki story" onPress={goPrev} style={{ width: '32%' }} />
                <Pressable accessibilityLabel="Sonraki story" onPress={goNext} style={{ flex: 1 }} />
              </View>
            ) : null}

            <View
              pointerEvents="box-none"
              style={{
                position: 'absolute',
                top: Math.max(insets.top, 12) + 8,
                left: 12,
                right: 12,
                gap: 10,
              }}>
              <View style={{ flexDirection: 'row', gap: 4 }}>
                {userStories.map((item, i) => (
                  <View key={item.id} style={{ flex: 1, height: 3, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.28)', overflow: 'hidden' }}>
                    <Animated.View
                      style={{
                        height: '100%',
                        borderRadius: 99,
                        backgroundColor: '#F4F1EA',
                        width:
                          i < userIndex
                            ? '100%'
                            : i > userIndex
                              ? '0%'
                              : fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                      }}
                    />
                  </View>
                ))}
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <LetterAvatar id={current.user_id} name={current.display_name} size={32} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText variant="subtitle" numberOfLines={1} style={{ color: '#F4F1EA' }}>
                    {mine ? 'Sen' : taggedName(current.display_name, current.display_tag)}
                  </AppText>
                  <AppText variant="caption" style={{ color: 'rgba(244,241,234,0.72)' }}>
                    {postedAt(current.created_at)}
                  </AppText>
                </View>
                <Pressable
                  onPress={() => openOverlay('menu')}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Story menüsü"
                  style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="ellipsis-horizontal" size={22} color="#F4F1EA" />
                </Pressable>
                <Pressable
                  onPress={closeViewer}
                  hitSlop={12}
                  accessibilityRole="button"
                  accessibilityLabel="Kapat"
                  style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
                  <Ionicons name="close" size={24} color="#F4F1EA" />
                </Pressable>
              </View>
            </View>

          </Animated.View>
        ) : null}

        {overlay !== 'none' ? (
          <Pressable
            onPress={closeOverlay}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: 0,
              bottom: 0,
              backgroundColor: 'rgba(8,12,20,0.55)',
              justifyContent: overlay === 'delete' ? 'center' : 'flex-end',
              padding: 20,
              paddingBottom: Math.max(insets.bottom, 20),
            }}>
            {overlay === 'menu' ? (
              <Pressable
                onPress={() => undefined}
                style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 8, borderWidth: 1, borderColor: colors.border }}>
                {mine ? (
                  <SheetRow
                    label="Story'yi sil"
                    danger
                    icon="trash-outline"
                    onPress={() => openOverlay('delete')}
                  />
                ) : (
                  <SheetRow label="Şikayet et" icon="flag-outline" onPress={() => openOverlay('report')} />
                )}
                <SheetRow label="Kapat" icon="close-outline" onPress={closeViewer} />
              </Pressable>
            ) : null}

            {overlay === 'delete' ? (
              <Pressable
                onPress={() => undefined}
                style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 18, gap: 12, borderWidth: 1, borderColor: colors.border }}>
                <AppText variant="subtitle">Bu story silinsin mi?</AppText>
                <AppText variant="caption" tone="muted">
                  Silinen story geri alınamaz.
                </AppText>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <Pressable
                    onPress={closeOverlay}
                    style={{ flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }}>
                    <AppText>Vazgeç</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => void confirmDelete()}
                    disabled={busy}
                    style={{ flex: 1, minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.danger }}>
                    <AppText tone="inverse">{busy ? '…' : 'Sil'}</AppText>
                  </Pressable>
                </View>
              </Pressable>
            ) : null}

            {overlay === 'report' ? (
              <Pressable
                onPress={() => undefined}
                style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 8, borderWidth: 1, borderColor: colors.border }}>
                <AppText variant="subtitle" style={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                  Story’yi şikayet et
                </AppText>
                {IMAGE_REPORT_REASONS.map((item) => (
                  <SheetRow
                    key={item.id}
                    label={item.label}
                    icon="flag-outline"
                    onPress={() => void submitReport(item.id)}
                  />
                ))}
                <SheetRow label="Kapat" icon="close-outline" onPress={closeOverlay} />
              </Pressable>
            ) : null}
          </Pressable>
        ) : null}
      </Animated.View>
    </Modal>
  );
}

function StoryMedia({ item, onReady }: { item: StoryItem; onReady: () => void }) {
  if (item.image_url.startsWith('media:')) {
    return <RemoteImage mediaId={item.image_url.slice(6)} resizeMode="contain" onReady={onReady} style={{ flex: 1, width: '100%' }} />;
  }
  return (
    <Image
      source={{ uri: item.image_url }}
      style={{ flex: 1, width: '100%' }}
      resizeMode="contain"
      onLoad={onReady}
    />
  );
}

function SheetRow({
  label,
  icon,
  danger,
  onPress,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  danger?: boolean;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        paddingHorizontal: 12,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Ionicons name={icon} size={20} color={danger ? colors.danger : colors.text} />
      <AppText style={{ fontWeight: '700', color: danger ? colors.danger : colors.text }}>{label}</AppText>
    </Pressable>
  );
}
