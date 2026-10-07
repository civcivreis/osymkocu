export type ColorSchemeName = 'light' | 'dark';

export type ThemeColors = {
  bg: string;
  bgMuted: string;
  surface: string;
  surfaceMuted: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  accent: string;
  accentMuted: string;
  accentText: string;
  navy: string;
  success: string;
  danger: string;
  warning: string;
  overlay: string;
  tabBar: string;
  tabInactive: string;
};

export const colors: Record<ColorSchemeName, ThemeColors> = {
  light: {
    bg: '#F4F1EA',
    bgMuted: '#E8E3D8',
    surface: '#FFFcf7',
    surfaceMuted: '#F7F2E8',
    text: '#142033',
    textMuted: '#5C6573',
    textSubtle: '#8A9280',
    border: '#E4DDD0',
    accent: '#C45C26',
    accentMuted: '#F3E0D4',
    accentText: '#FFFFFF',
    navy: '#1B2B44',
    success: '#1F7A4D',
    danger: '#B42318',
    warning: '#B45309',
    overlay: 'rgba(20, 32, 51, 0.45)',
    tabBar: '#FFFcf7',
    tabInactive: '#8B93A1',
  },
  dark: {
    bg: '#0E1520',
    bgMuted: '#151D2B',
    surface: '#172133',
    surfaceMuted: '#1E2B40',
    text: '#F4F1EA',
    textMuted: '#A8B0BD',
    textSubtle: '#7B8494',
    border: '#2A374C',
    accent: '#E07A3D',
    accentMuted: '#3A2A22',
    accentText: '#141414',
    navy: '#8FB3D9',
    success: '#3DDC97',
    danger: '#F97066',
    warning: '#F5A524',
    overlay: 'rgba(0, 0, 0, 0.55)',
    tabBar: '#121A28',
    tabInactive: '#7B8494',
  },
};
