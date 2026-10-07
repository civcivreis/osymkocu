import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, View, type ImageStyle, type StyleProp } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { useSignedMediaUrl } from '@/src/features/media/useSignedMediaUrl';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function RemoteImage({
  uri,
  mediaId,
  style,
  accessibilityLabel,
  resizeMode = 'cover',
  onPress,
}: {
  uri?: string | null;
  mediaId?: string | null;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  resizeMode?: 'cover' | 'contain' | 'stretch';
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const signed = useSignedMediaUrl(mediaId ?? null);
  const resolved = mediaId ? signed.data?.url ?? null : uri ?? null;
  const [failed, setFailed] = useState(false);
  const waiting = Boolean(mediaId) && signed.isFetching && !resolved;
  const inner = (
    <View style={[{ backgroundColor: colors.bgMuted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }, style]}>
      {resolved && !failed ? (
        <Image
          source={{ uri: resolved }}
          accessibilityLabel={accessibilityLabel}
          resizeMode={resizeMode}
          style={{ width: '100%', height: '100%' }}
          onError={() => setFailed(true)}
        />
      ) : waiting ? (
        <ActivityIndicator color={colors.accent} />
      ) : (
        <Pressable
          onPress={() => {
            setFailed(false);
            if (mediaId) void signed.refetch();
          }}
          accessibilityRole="button"
          accessibilityLabel="Görseli yeniden dene">
          <AppText variant="caption" tone="muted">
            Görsel yok
          </AppText>
        </Pressable>
      )}
    </View>
  );
  if (onPress && resolved && !failed) {
    return (
      <Pressable onPress={onPress} accessibilityRole="imagebutton" accessibilityLabel={accessibilityLabel}>
        {inner}
      </Pressable>
    );
  }
  return inner;
}
