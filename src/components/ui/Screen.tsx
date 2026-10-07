import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  center?: boolean;
  style?: ViewStyle;
  safeEdges?: Edge[];
};

export function Screen({ children, scroll, center, style, safeEdges = ['top', 'bottom'] }: Props) {
  const { colors, spacing } = useAppTheme();

  const content = scroll ? (
    <ScrollView
      keyboardShouldPersistTaps="handled"
      contentContainerStyle={[
        styles.scroll,
        { padding: spacing.screen, justifyContent: center ? 'center' : undefined },
        style,
      ]}
      showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View
      style={[
        { flex: 1, padding: spacing.screen, justifyContent: center ? 'center' : undefined },
        style,
      ]}>
      {children}
    </View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={safeEdges}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1, paddingBottom: 32 },
});
