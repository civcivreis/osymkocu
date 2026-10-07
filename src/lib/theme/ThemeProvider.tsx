import { DarkTheme, DefaultTheme, ThemeProvider as NavThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import {
    createContext,
    useContext,
    useMemo,
    type ReactNode,
} from 'react';
import { useColorScheme as useSystemColorScheme } from 'react-native';

import { useThemeStore, type ThemePreference } from '@/src/stores/themeStore';

import { colors, type ColorSchemeName, type ThemeColors } from './colors';
import { radius, shadows, spacing } from './spacing';

type ThemeContextValue = {
  scheme: ColorSchemeName;
  preference: ThemePreference;
  colors: ThemeColors;
  spacing: typeof spacing;
  radius: typeof radius;
  shadows: typeof shadows;
  setPreference: (preference: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function buildNavTheme(scheme: ColorSchemeName) {
  const c = colors[scheme];
  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return {
    ...base,
    dark: scheme === 'dark',
    colors: {
      ...base.colors,
      primary: c.accent,
      background: c.bg,
      card: c.surface,
      text: c.text,
      border: c.border,
      notification: c.accent,
    },
  };
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const system = useSystemColorScheme();
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);

  const scheme: ColorSchemeName =
    preference === 'system' ? (system === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      scheme,
      preference,
      colors: colors[scheme],
      spacing,
      radius,
      shadows,
      setPreference,
    }),
    [scheme, preference, setPreference],
  );

  return (
    <ThemeContext.Provider value={value}>
      <NavThemeProvider value={buildNavTheme(scheme)}>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        {children}
      </NavThemeProvider>
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme ThemeProvider dışında kullanılamaz');
  }
  return ctx;
}
