import { Linking, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { ChatImageViewer } from '@/src/features/social/ChatImage';
import { chatImageUrl, isImageMessage, type ChatMedia } from '@/src/features/social/chatMedia';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useMemo, useState } from 'react';

const LINK_RE = /https?:\/\/[^\s]+/gi;

type MediaRow = ChatMedia & { id: string; body?: string | null };

export function ConversationMediaPanel({ messages }: { messages: MediaRow[] }) {
  const { colors } = useAppTheme();
  const [viewer, setViewer] = useState<MediaRow | null>(null);
  const photos = useMemo(() => messages.filter((item) => isImageMessage(item)), [messages]);
  const links = useMemo(() => {
    const found: string[] = [];
    for (const item of messages) {
      const body = item.body ?? '';
      const hits = body.match(LINK_RE) ?? [];
      for (const hit of hits) {
        if (!found.includes(hit)) found.push(hit);
      }
    }
    return found;
  }, [messages]);

  return (
    <View style={{ gap: 10 }}>
      <AppText variant="label" tone="accent">
        FOTOĞRAFLAR
      </AppText>
      {photos.length === 0 ? (
        <AppText variant="caption" tone="muted">
          Henüz ortak fotoğraf yok.
        </AppText>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {photos.slice(0, 12).map((item) => (
            <RemoteImage
              key={item.id}
              mediaId={item.media_id}
              uri={chatImageUrl(item.image_path)}
              accessibilityLabel="Sohbet fotoğrafı"
              style={{ width: 72, height: 72, borderRadius: 12 }}
              onPress={() => setViewer(item)}
            />
          ))}
        </View>
      )}
      {links.length > 0 ? (
        <>
          <AppText variant="label" tone="accent">
            LİNKLER
          </AppText>
          {links.slice(0, 8).map((href) => (
            <Pressable key={href} onPress={() => void Linking.openURL(href)}>
              <AppText variant="caption" tone="accent" numberOfLines={1}>
                {href}
              </AppText>
            </Pressable>
          ))}
        </>
      ) : null}
      <ChatImageViewer
        visible={Boolean(viewer)}
        mediaId={viewer?.media_id}
        uri={viewer ? chatImageUrl(viewer.image_path) : null}
        caption={viewer?.body}
        onClose={() => setViewer(null)}
      />
      <View style={{ height: 1, backgroundColor: colors.border, opacity: 0 }} />
    </View>
  );
}
