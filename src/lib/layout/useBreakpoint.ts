import { Platform, useWindowDimensions } from 'react-native';

export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1100,
} as const;

export function useBreakpoint() {
  const dims = useWindowDimensions();
  const width = dims.width > 0 ? dims.width : Platform.OS === 'web' ? 1280 : 0;
  const height = dims.height > 0 ? dims.height : 900;
  const isWeb = Platform.OS === 'web';
  const isDesktop = isWeb && width >= BREAKPOINTS.desktop;
  const isTablet = isWeb && width >= BREAKPOINTS.tablet && width < BREAKPOINTS.desktop;
  const isMobileWeb = isWeb && width < BREAKPOINTS.tablet;
  return {
    width,
    height,
    isWeb,
    isDesktop,
    isTablet,
    isMobileWeb,
    showSidebar: isWeb && width >= BREAKPOINTS.tablet,
    compactSidebar: isTablet,
    showBottomNav: isMobileWeb,
    showTopBar: isWeb && width >= BREAKPOINTS.tablet,
    contentMaxWidth: 1400,
    contentPad: width >= BREAKPOINTS.desktop ? 32 : width >= BREAKPOINTS.tablet ? 24 : 16,
  };
}
