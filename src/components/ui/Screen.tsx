import { type ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets, type Edge } from 'react-native-safe-area-context';

import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

type Props = {
  children: ReactNode;
  scroll?: boolean;
  center?: boolean;
  wide?: boolean;
  style?: ViewStyle;
  safeEdges?: Edge[];
};

export function Screen({ children, scroll, center, wide, style, safeEdges }: Props) {
  const { colors } = useAppTheme();
  const { showSidebar, showTopBar, contentMaxWidth, contentPad } = useBreakpoint();
  const insets = useSafeAreaInsets();
  const edges: Edge[] = safeEdges ?? (showSidebar ? [] : ['top']);
  const maxWidth = wide ? Math.max(contentMaxWidth, 1280) : contentMaxWidth;
  const padLeft = Math.max(contentPad, showSidebar ? 0 : insets.left);
  const padRight = Math.max(contentPad, showSidebar ? 0 : insets.right);

  const innerStyle: ViewStyle[] = [
    scroll ? styles.scroll : { flex: 1, minWidth: 0 },
    {
      paddingLeft: padLeft,
      paddingRight: padRight,
      paddingTop: showTopBar ? 20 : contentPad,
      paddingBottom: 32,
      width: '100%',
      maxWidth,
      marginHorizontal: 'auto',
      alignSelf: 'center',
      alignItems: 'stretch',
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
