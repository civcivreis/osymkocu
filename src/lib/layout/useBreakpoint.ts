import { Platform, useWindowDimensions } from 'react-native';

export const BREAKPOINTS = {
  tablet: 768,
  desktop: 1024,
} as const;

export function useBreakpoint() {
  const { width, height } = useWindowDimensions();
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
    showBottomNav: isMobileWeb,
  };
}
