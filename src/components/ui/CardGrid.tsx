import { Children, useState, type ReactNode } from 'react';
import { View, type LayoutChangeEvent, type ViewStyle } from 'react-native';

import { BREAKPOINTS, useBreakpoint } from '@/src/lib/layout/useBreakpoint';

type Props = {
  children: ReactNode;
  columns?: 1 | 2 | 3;
  gap?: number;
  /** Caps a lone card so it does not stretch the full desktop row. */
  singleMaxWidth?: number;
  style?: ViewStyle;
};

export function CardGrid({ children, columns, gap = 16, singleMaxWidth = 720, style }: Props) {
  const { width: viewport } = useBreakpoint();
  const cols = columns ?? (viewport >= BREAKPOINTS.desktop ? 3 : viewport >= BREAKPOINTS.tablet ? 2 : 1);
  const items = Children.toArray(children);
  const [width, setWidth] = useState(0);

  const onLayout = (event: LayoutChangeEvent) => {
    const next = Math.round(event.nativeEvent.layout.width);
    if (next > 0 && next !== width) setWidth(next);
  };

  const itemWidth =
    width <= 0 ? undefined : cols <= 1 ? width : Math.floor((width - gap * (cols - 1)) / cols);
  const lone = items.length === 1;

  return (
    <View
      onLayout={onLayout}
      style={[
        {
          width: '100%',
          marginHorizontal: 0,
          alignSelf: 'center',
          flexDirection: 'row',
          flexWrap: 'wrap',
          gap,
          justifyContent: lone ? 'center' : 'flex-start',
        },
        style,
      ]}>
      {items.map((child, index) => (
        <View
          key={(child as { key?: string | number }).key ?? index}
          style={{
            width: lone && cols > 1 ? Math.min(itemWidth ?? width, singleMaxWidth) : itemWidth,
            maxWidth: lone ? singleMaxWidth : itemWidth,
            alignSelf: lone ? 'center' : undefined,
          }}>
          {child}
        </View>
      ))}
    </View>
  );
}
