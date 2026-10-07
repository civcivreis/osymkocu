import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Tab<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  value: T;
  tabs: Tab<T>[];
  onChange: (value: T) => void;
};

export function SegmentedTabs<T extends string>({ value, tabs, onChange }: Props<T>) {
  const { colors } = useAppTheme();
  const index = Math.max(0, tabs.findIndex((tab) => tab.value === value));
  const [track, setTrack] = useState(0);
  const slide = useRef(new Animated.Value(index)).current;
  const count = Math.max(tabs.length, 1);
  const pad = 3;
  const inner = Math.max(0, track - pad * 2);
  const pill = inner / count;

  useEffect(() => {
    Animated.timing(slide, {
      toValue: index,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [index, slide]);

  return (
    <View
      onLayout={(event) => setTrack(event.nativeEvent.layout.width)}
      style={{
        flexDirection: 'row',
        backgroundColor: colors.bgMuted,
        borderRadius: 999,
        padding: pad,
        height: 44,
        overflow: 'hidden',
      }}>
      {pill > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: pad,
            bottom: pad,
            width: pill,
            left: pad,
            borderRadius: 999,
            backgroundColor: colors.accentMuted,
            borderWidth: 1,
            borderColor: colors.accent,
            transform: [{ translateX: Animated.multiply(slide, pill) }],
          }}
        />
      ) : null}
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <Pressable
            key={tab.value}
            onPress={() => onChange(tab.value)}
            style={{ flex: 1, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
            <AppText variant="label" tone={selected ? 'accent' : 'muted'} style={{ fontWeight: '700' }}>
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}
