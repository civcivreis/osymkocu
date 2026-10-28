import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function ChatThreadList({
  threadKey,
  pad,
  children,
  itemCount,
  empty,
}: {
  threadKey: string;
  pad: number;
  children: ReactNode;
  itemCount: number;
  empty?: ReactNode;
}) {
  const { colors } = useAppTheme();
  const scroller = useRef<ScrollView>(null);
  const pinToLatest = useRef(true);
  const ready = useRef(false);
  const lastCount = useRef(0);
  const [jump, setJump] = useState(false);

  const goLatest = useCallback((animated: boolean) => {
    pinToLatest.current = true;
    setJump(false);
    scroller.current?.scrollToEnd({ animated });
  }, []);

  useEffect(() => {
    ready.current = false;
    pinToLatest.current = true;
    lastCount.current = 0;
    setJump(false);
  }, [threadKey]);

  useEffect(() => {
    const grew = itemCount > lastCount.current;
    lastCount.current = itemCount;
    if (pinToLatest.current) {
      const frame = requestAnimationFrame(() => goLatest(false));
      return () => cancelAnimationFrame(frame);
    }
    if (grew) setJump(true);
    return undefined;
  }, [goLatest, itemCount]);

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <ScrollView
        ref={scroller}
        style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{
          paddingHorizontal: pad,
          paddingVertical: 12,
          flexGrow: 1,
          justifyContent: 'flex-end',
        }}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => {
          if (!pinToLatest.current) return;
          scroller.current?.scrollToEnd({ animated: false });
          ready.current = true;
        }}
        onScroll={(event) => {
          if (!ready.current) return;
          const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
          const atBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 72;
          pinToLatest.current = atBottom;
          setJump(!atBottom);
        }}
        scrollEventThrottle={16}>
        {itemCount === 0 ? empty : children}
      </ScrollView>
      {jump ? (
        <Pressable
          onPress={() => goLatest(true)}
          accessibilityLabel="En yeni mesajlara in"
          style={{
            position: 'absolute',
            right: pad,
            bottom: 12,
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.surface,
            borderWidth: 1,
            borderColor: colors.border,
            shadowColor: '#142033',
            shadowOpacity: 0.12,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
          }}>
          <Ionicons name="chevron-down" size={22} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}
