import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

export function StudySplitLayout({
  media,
  chat,
  landscape,
}: {
  media: ReactNode;
  chat?: ReactNode;
  landscape: boolean;
}) {
  const lesson = (
    <ScrollView
      style={{ flex: 1, minHeight: 0 }}
      contentContainerStyle={{ gap: 12, paddingBottom: 28, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator>
      {media}
    </ScrollView>
  );

  if (landscape && chat) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', gap: 12, minHeight: 0, width: '100%' }}>
        <View style={{ flex: 7, minWidth: 0, minHeight: 0 }}>{lesson}</View>
        <View style={{ flex: 3, minWidth: 240, maxWidth: 420, minHeight: 0 }}>{chat}</View>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, minHeight: 0, width: '100%', gap: 12 }}>
      {lesson}
      {chat}
    </View>
  );
}
