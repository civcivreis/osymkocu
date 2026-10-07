import { View, Text } from 'react-native';

import { landing as T } from '@/src/features/web/landing/tokens';
import { APP_NAME } from '@/src/lib/brand';

/** Original mark: open page + check. Not the official ÖSYM emblem. */
export function BrandLogo({
  variant = 'full',
  size = 28,
}: {
  variant?: 'full' | 'mark';
  size?: number;
}) {
  const r = Math.round(size * 0.28);
  const mark = (
    <View
      accessibilityLabel="ÖSYM Koçu"
      style={{
        width: size,
        height: size,
        borderRadius: r,
        backgroundColor: T.navy,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <View
        style={{
          width: size * 0.46,
          height: size * 0.34,
          borderWidth: 1.6,
          borderColor: T.white,
          borderRadius: 3,
          backgroundColor: 'transparent',
        }}
      />
      <View
        style={{
          position: 'absolute',
          right: size * 0.14,
          bottom: size * 0.14,
          width: size * 0.34,
          height: size * 0.34,
          borderRadius: size * 0.17,
          backgroundColor: T.orange,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        <View
          style={{
            width: size * 0.12,
            height: size * 0.07,
            borderLeftWidth: 2,
            borderBottomWidth: 2,
            borderColor: T.white,
            transform: [{ rotate: '-45deg' }, { translateY: -1 }],
          }}
        />
      </View>
    </View>
  );

  if (variant === 'mark') return mark;

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      {mark}
      <Text style={{ color: T.navy, fontSize: 18, fontWeight: '800', letterSpacing: -0.3 }}>{APP_NAME}</Text>
    </View>
  );
}
