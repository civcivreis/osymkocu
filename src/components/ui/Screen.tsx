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

import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  center?: boolean;
  style?: ViewStyle;
  safeEdges?: Edge[];
};

export function Screen({ children, scroll, center, style, safeEdges }: Props) {
  const { colors } = useAppTheme();
  const { showSidebar, showTopBar, contentMaxWidth, contentPad } = useBreakpoint();
  const edges: Edge[] = safeEdges ?? (showSidebar ? [] : ['top']);

  const innerStyle: ViewStyle[] = [
    scroll ? styles.scroll : { flex: 1 },
    {
      paddingHorizontal: contentPad,
      paddingTop: showTopBar ? 20 : contentPad,
      paddingBottom: 32,
      width: '100%',
      maxWidth: contentMaxWidth,
      alignSelf: 'center',
      justifyContent: center ? 'center' : undefined,
    },
    style ?? {},
  ];

  const content = scroll ? (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={innerStyle} showsVerticalScrollIndicator={false}>
      {children}
    </ScrollView>
  ) : (
    <View style={innerStyle}>{children}</View>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg }]} edges={edges}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {content}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  flex: { flex: 1 },
  scroll: { flexGrow: 1 },
});
