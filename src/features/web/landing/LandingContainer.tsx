import { type ReactNode } from 'react';
import { View } from 'react-native';

import { landing as T, landingPad } from '@/src/features/web/landing/tokens';

export function LandingContainer({
  children,
  width,
}: {
  children: ReactNode;
  width: number;
}) {
  return (
    <View
      style={{
        width: '100%',
        maxWidth: T.max,
        alignSelf: 'center',
        paddingHorizontal: landingPad(width),
      }}>
      {children}
    </View>
  );
}
