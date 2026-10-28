import { useEffect, useRef } from 'react';
import { Animated, Image, Text, View } from 'react-native';

import { nativeDriver } from '@/src/lib/animation/nativeDriver';

import { overlayCardAt } from './playerUtils';
import type { MemoryLessonScene } from './types';

export function SceneCanvas({
  scene,
  imageUrl,
  positionMs,
}: {
  scene: MemoryLessonScene | null;
  imageUrl?: string;
  positionMs: number;
}) {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const pan = useRef(new Animated.Value(0)).current;
  const beat = overlayCardAt(scene, positionMs);
  const label = beat?.label && beat.label !== beat.text ? beat.label : null;

  useEffect(() => {
    opacity.setValue(0.7);
    scale.setValue(1.04);
    pan.setValue(0);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 480, useNativeDriver: nativeDriver }),
      Animated.timing(scale, { toValue: 1.02, duration: 14000, useNativeDriver: nativeDriver }),
      Animated.timing(pan, { toValue: 1, duration: 14000, useNativeDriver: nativeDriver }),
    ]).start();
  }, [opacity, pan, scale, scene?.id]);

  const translateX = pan.interpolate({ inputRange: [0, 1], outputRange: [-2, 2] });

  return (
    <View style={{ width: '100%', aspectRatio: 16 / 9, borderRadius: 18, overflow: 'hidden', backgroundColor: '#1A2433', position: 'relative' }}>
      {imageUrl ? (
        <Animated.View style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, opacity, transform: [{ scale }, { translateX }] }}>
          <Image source={{ uri: imageUrl }} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
        </Animated.View>
      ) : (
        <View style={{ flex: 1, backgroundColor: '#243044' }} />
      )}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', zIndex: 2, top: 0, right: 0, bottom: 0, left: 0, backgroundColor: 'rgba(8,16,28,0.22)' }}
      />
      {label ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            zIndex: 4,
            top: 12,
            right: 12,
            maxWidth: '40%',
            borderRadius: 12,
            paddingHorizontal: 10,
            paddingVertical: 6,
            backgroundColor: 'rgba(246,241,232,0.96)',
          }}>
          <Text style={{ color: '#C45C26', fontSize: 12, fontWeight: '800' }}>{label}</Text>
        </View>
      ) : null}
      {beat ? (
        <View pointerEvents="none" style={{ position: 'absolute', zIndex: 5, left: 14, right: 14, bottom: 16 }}>
          <View
            style={{
              alignSelf: 'flex-start',
              paddingHorizontal: 10,
              paddingVertical: 4,
              borderRadius: 999,
              backgroundColor: '#C45C26',
              marginBottom: 8,
            }}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>{beat.kicker}</Text>
          </View>
          <View style={{ borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, backgroundColor: 'rgba(15,28,46,0.92)' }}>
            <Text style={{ color: '#FFFFFF', fontSize: 20, lineHeight: 26, fontWeight: '800' }}>{beat.text}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
