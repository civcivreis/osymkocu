import { View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';

export function SystemShareMark({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <View accessibilityLabel="Sistem paylaşımı">
      <AppText variant="caption" tone="muted">
        Sistem paylaşımı
      </AppText>
    </View>
  );
}
