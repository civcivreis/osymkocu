import { useEffect, useRef } from 'react';
import { Animated, Image, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { nativeDriver } from '@/src/lib/animation/nativeDriver';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

import { captionLines } from './playerUtils';
import type { MemoryLessonScene } from './types';

export function SceneCanvas({
  scene,
  imageUrl,
  emphasizeAnchor,
}: {
  scene: MemoryLessonScene | null;
  imageUrl?: string;
  emphasizeAnchor?: boolean;
}) {
  const { colors, radius } = useAppTheme();
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    opacity.setValue(0.55);
    scale.setValue(emphasizeAnchor ? 1.04 : 1.02);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: nativeDriver }),
      Animated.timing(scale, { toValue: 1, duration: emphasizeAnchor ? 1400 : 900, useNativeDriver: nativeDriver }),
    ]).start();
  }, [emphasizeAnchor, opacity, scale, scene?.id]);

  return (
    <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: '#E8E3D8' }}>
      {imageUrl ? (
        <Animated.View style={{ flex: 1, opacity, transform: [{ scale }] }}>
          <Image source={{ uri: imageUrl }} resizeMode="cover" style={{ width: '100%', height: '100%' }} />
        </Animated.View>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}>
          <AppText tone="muted">{scene?.visual_anchor || 'Sahne görseli yükleniyor'}</AppText>
        </View>
      )}
      {scene ? (
        <View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            bottom: 12,
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 10,
            backgroundColor: 'rgba(15,28,46,0.62)',
            gap: 4,
          }}>
          <AppText tone="inverse" style={{ fontSize: 15, lineHeight: 21 }}>
            {captionLines(scene.caption || scene.narration_text)}
          </AppText>
          {scene.memory_target ? (
            <AppText style={{ color: colors.accent, fontWeight: '700', fontSize: 13 }}>
              {scene.visual_anchor ? `${scene.visual_anchor} → ${scene.memory_target}` : scene.memory_target}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
