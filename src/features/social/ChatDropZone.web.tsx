import { useState, type ReactNode } from 'react';
import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { pickedImageFromFile } from '@/src/features/media/pickDeviceImage';
import type { PendingChatImage } from '@/src/features/social/ChatComposer';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function ChatDropZone({
  children,
  onImage,
}: {
  children: ReactNode;
  onImage?: (image: PendingChatImage) => void;
}) {
  const { colors } = useAppTheme();
  const [over, setOver] = useState(false);

  return (
    <View
      style={{ flex: 1, position: 'relative' }}
      // @ts-expect-error RN web drag events
      onDragEnter={(event: { preventDefault: () => void }) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragOver={(event: { preventDefault: () => void }) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event: { preventDefault: () => void; dataTransfer?: { files?: FileList } }) => {
        event.preventDefault();
        setOver(false);
        const file = event.dataTransfer?.files?.[0];
        if (!file || !onImage) return;
        void pickedImageFromFile(file).then((asset) => {
          if (asset) onImage(asset);
        });
      }}>
      {children}
      {over ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 8,
            right: 8,
            top: 8,
            bottom: 8,
            borderRadius: 16,
            borderWidth: 2,
            borderColor: colors.accent,
            backgroundColor: 'rgba(232,160,112,0.12)',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <AppText variant="label" tone="accent">
            Fotoğrafı bırak
          </AppText>
        </View>
      ) : null}
    </View>
  );
}
