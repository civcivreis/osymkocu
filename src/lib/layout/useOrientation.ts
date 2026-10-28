import { useWindowDimensions } from 'react-native';

import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';

export function useOrientation() {
  const { width, height, isDesktop, isTablet } = useBreakpoint();
  const dims = useWindowDimensions();
  const w = width || dims.width;
  const h = height || dims.height;
  const landscape = w > h;
  return {
    width: w,
    height: h,
    landscape,
    portrait: !landscape,
    wideChrome: landscape || isDesktop || isTablet,
  };
}
