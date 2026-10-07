export type ColorSchemeName = 'light' | 'dark';

export type ThemeColors = {
  bg: string;
  bgMuted: string;
  surface: string;
  surfaceMuted: string;
  surfaceElevated: string;
  text: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textSubtle: string;
  border: string;
  accent: string;
  orange: string;
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
    bg: '#F6F1E8',
    bgMuted: '#EDE6D8',
    surface: '#FFFCF7',
    surfaceMuted: '#F7F2E8',
    surfaceElevated: '#FFFFFF',
    text: '#0F1C2E',
    textPrimary: '#0F1C2E',
    textSecondary: '#334155',
    textMuted: '#475569',
    textSubtle: '#64748B',
    border: '#E4DDD0',
    accent: '#C45C26',
    orange: '#C45C26',
    accentMuted: '#F4E2D6',
    accentText: '#FFFFFF',
    navy: '#0F1C2E',
    success: '#176C44',
    danger: '#B42318',
    warning: '#B45309',
    overlay: 'rgba(15, 28, 46, 0.45)',
    tabBar: '#FFFCF7',
    tabInactive: '#64748B',
  },
  dark: {
    bg: '#0E1520',
    bgMuted: '#151D2B',
    surface: '#172133',
    surfaceMuted: '#1E2B40',
    surfaceElevated: '#1F2C42',
    text: '#F4F1EA',
    textPrimary: '#F4F1EA',
    textSecondary: '#CBD5E1',
    textMuted: '#A8B0BD',
    textSubtle: '#7B8494',
    border: '#2A374C',
    accent: '#E07A3D',
    orange: '#E07A3D',
    accentMuted: '#3A2A22',
    accentText: '#141414',
    navy: '#D7E3F0',
    success: '#3DDC97',
    danger: '#F97066',
    warning: '#F5A524',
    overlay: 'rgba(0, 0, 0, 0.55)',
    tabBar: '#121A28',
    tabInactive: '#7B8494',
  },
};
