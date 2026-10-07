import { Image, useWindowDimensions, type ImageStyle, type StyleProp } from 'react-native';

import { APP_NAME } from '@/src/lib/brand';

const MARK = require('@/assets/brand/brand-mark.png');
const LOGO = require('@/assets/brand/brand-logo.png');

/** Native pixel size of brand-logo.png */
const LOGO_ASPECT = 2172 / 724;

type Props = {
  variant?: 'full' | 'mark';
  /** Square edge for `mark`. */
  size?: number;
  /** Horizontal width for `full`. Defaults: 168 desktop / 132 mobile. */
  width?: number;
  style?: StyleProp<ImageStyle>;
};

export function BrandLogo({ variant = 'full', size, width, style }: Props) {
  const { width: viewport } = useWindowDimensions();

  if (variant === 'mark') {
    const edge = size ?? 32;
    return (
      <Image
        source={MARK}
        accessibilityLabel={APP_NAME}
        resizeMode="contain"
        style={[{ width: edge, height: edge }, style]}
      />
    );
  }

  const logoWidth = width ?? (viewport >= 768 ? 168 : 132);
  const logoHeight = Math.round(logoWidth / LOGO_ASPECT);

  return (
    <Image
      source={LOGO}
      accessibilityLabel={APP_NAME}
      resizeMode="contain"
      style={[{ width: logoWidth, height: logoHeight }, style]}
    />
  );
}
