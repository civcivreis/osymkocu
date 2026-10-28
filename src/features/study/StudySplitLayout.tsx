import type { ReactNode } from 'react';
import { View } from 'react-native';

export function StudySplitLayout({
  media,
  chat,
  landscape,
}: {
  media: ReactNode;
  chat?: ReactNode;
  landscape: boolean;
}) {
  if (landscape && chat) {
    return (
      <View style={{ flex: 1, flexDirection: 'row', gap: 12, minHeight: 0, width: '100%' }}>
        <View style={{ flex: 7, minWidth: 0, minHeight: 0 }}>{media}</View>
        <View style={{ flex: 3, minWidth: 240, maxWidth: 420, minHeight: 0 }}>{chat}</View>
      </View>
    );
  }
  return (
    <View style={{ width: '100%', gap: 12, flex: landscape ? 1 : undefined, minHeight: 0 }}>
      {media}
      {chat}
    </View>
  );
}
