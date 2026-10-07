import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppText } from '@/src/components/ui/AppText';
import { clockLabel } from '@/src/features/social/identity';
import { imageBox } from '@/src/features/social/chatMedia';
import { useSignedMediaUrl } from '@/src/features/media/useSignedMediaUrl';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

export function ChatImageThumb({
  mediaId,
  uri,
  width,
  height,
  mine,
  onPress,
}: {
  mediaId?: string | null;
  uri?: string | null;
  width?: number | null;
  height?: number | null;
  mine?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const signed = useSignedMediaUrl(mediaId);
  const resolved = mediaId ? signed.data?.url ?? null : uri ?? null;
  const size = imageBox(width ?? signed.data?.width, height ?? signed.data?.height);
  const [token, setToken] = useState(0);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const waiting = Boolean(mediaId) && (signed.isFetching || (!resolved && !signed.isError));
  const failed = failedUrl === resolved || Boolean(mediaId && signed.isError && !resolved);
  const showImage = Boolean(resolved) && !failed;
  const loading = (!failed && !resolved) || waiting;

  return (
    <Pressable onPress={showImage ? onPress : undefined} style={{ width: size.width }}>
      <View
        style={{
          width: size.width,
          height: size.height,
          borderRadius: 16,
          overflow: 'hidden',
          backgroundColor: mine ? 'rgba(255,255,255,0.18)' : colors.bgMuted,
          alignItems: 'center',
          justifyContent: 'center',
        }}>
        {showImage && resolved ? (
          <Image
            source={{ uri: `${resolved}${token ? `${resolved.includes('?') ? '&' : '?'}r=${token}` : ''}` }}
            style={{ width: size.width, height: size.height }}
            resizeMode="cover"
            onError={() => setFailedUrl(resolved)}
          />
        ) : null}
        {loading ? (
          <View style={{ position: 'absolute' }}>
            <ActivityIndicator color={mine ? '#fff' : colors.accent} />
          </View>
        ) : null}
        {failed ? (
          <Pressable
            onPress={() => {
              setToken(Date.now());
              setFailedUrl(null);
              void signed.refetch();
            }}
            style={{ alignItems: 'center', gap: 6, padding: 12 }}>
            <Ionicons name="refresh" size={20} color={mine ? '#fff' : colors.accent} />
            <AppText variant="caption" tone={mine ? 'inverse' : 'accent'}>
              Yeniden dene
            </AppText>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

export function ChatImageViewer({
  visible,
  mediaId,
  uri,
  sender,
  time,
  caption,
  onClose,
}: {
  visible: boolean;
  mediaId?: string | null;
  uri: string | null;
  sender?: string;
  time?: string | null;
  caption?: string | null;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  const zoom = useRef<ScrollView>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const signed = useSignedMediaUrl(visible ? mediaId : null);
  const resolved = mediaId ? signed.data?.url ?? null : uri;
  const failed = failedUrl === resolved || Boolean(mediaId && signed.isError && !resolved && !signed.isFetching);

  const save = () => {
    if (!resolved) return;
    void Linking.openURL(resolved);
  };

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose} transparent={false}>
      <View style={{ flex: 1, backgroundColor: '#0E1520' }}>
        <View
          style={{
            paddingTop: insets.top + 8,
            paddingHorizontal: 16,
            paddingBottom: 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}>
          <Pressable onPress={onClose} hitSlop={10} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="close" size={26} color="#F4F1EA" />
          </Pressable>
          <View style={{ flex: 1 }}>
            {sender ? (
              <AppText style={{ color: '#F4F1EA', fontWeight: '700' }} numberOfLines={1}>
                {sender}
              </AppText>
            ) : null}
            {time ? (
              <AppText variant="caption" style={{ color: 'rgba(244,241,234,0.7)' }}>
                {clockLabel(time)}
              </AppText>
            ) : null}
          </View>
          {resolved ? (
            <Pressable onPress={save} hitSlop={8} style={{ paddingHorizontal: 8, minHeight: 40, justifyContent: 'center' }}>
              <AppText variant="label" style={{ color: '#F4F1EA' }}>
                Aç
              </AppText>
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          ref={zoom}
          style={{ flex: 1 }}
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          maximumZoomScale={Platform.OS === 'ios' ? 4 : 1}
          minimumZoomScale={1}
          centerContent
          bounces={false}>
          {resolved && !failed ? (
            <Image
              source={{ uri: resolved }}
              style={{ width: '100%', height: 520 }}
              resizeMode="contain"
              onError={() => setFailedUrl(resolved)}
            />
          ) : signed.isFetching ? (
            <ActivityIndicator color="#F4F1EA" />
          ) : (
            <View style={{ alignItems: 'center', gap: 8 }}>
              <AppText style={{ color: '#F4F1EA' }}>Görsel açılamadı.</AppText>
              <Pressable onPress={() => { setFailedUrl(null); void signed.refetch(); }}>
                <AppText variant="label" style={{ color: '#E8A070' }}>
                  Yeniden dene
                </AppText>
              </Pressable>
            </View>
          )}
        </ScrollView>
        {caption ? (
          <View style={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 16 }}>
            <AppText style={{ color: '#F4F1EA' }}>{caption}</AppText>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}
