import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  View,
} from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { taggedName } from '@/src/features/social/identity';
import { pickDeviceImage } from '@/src/features/media/pickDeviceImage';
import { usePublishStory, useStories, type StoryItem } from '@/src/features/social/useSocial';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

export function StoriesRail() {
  const { colors } = useAppTheme();
  const me = useAuthStore((s) => s.session?.user.id);
  const stories = useStories();
  const publish = usePublishStory();
  const [open, setOpen] = useState<StoryItem | null>(null);

  const rings = useMemo(() => {
    const seen = new Set<string>();
    const list: StoryItem[] = [];
    for (const item of stories.data ?? []) {
      if (seen.has(item.user_id)) continue;
      seen.add(item.user_id);
      list.push(item);
    }
    return list;
  }, [stories.data]);

  const addStory = async () => {
    const asset = await pickDeviceImage({ source: 'library', quality: 0.55, aspect: [9, 16], allowsEditing: true });
    if (!asset) return;
    try {
      await publish.mutateAsync({ base64: asset.base64 });
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <View style={{ width: '100%', alignSelf: 'stretch', minWidth: 0 }}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ width: '100%' }}
        contentContainerStyle={{ gap: 12, paddingRight: 8 }}>
        <Pressable onPress={() => void addStory()} style={{ alignItems: 'center', width: 72 }}>
          <View
            style={{
              width: 68,
              height: 68,
              borderRadius: 34,
              borderWidth: 2,
              borderColor: colors.accent,
              borderStyle: 'dashed',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surface,
            }}>
            <Ionicons name="add" size={26} color={colors.accent} />
          </View>
          <AppText variant="caption" numberOfLines={1} style={{ marginTop: 6 }}>
            Story
          </AppText>
        </Pressable>
        {rings.map((item) => (
          <Pressable key={item.user_id} onPress={() => setOpen(item)} style={{ alignItems: 'center', width: 72 }}>
            <View
              style={{
                width: 68,
                height: 68,
                borderRadius: 34,
                padding: 2,
                borderWidth: 2,
                borderColor: item.user_id === me ? colors.navy : colors.accent,
              }}>
              {item.image_url.startsWith('media:') ? (
                <RemoteImage
                  mediaId={item.image_url.slice(6)}
                  style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceMuted }}
                />
              ) : (
                <Image
                  source={{ uri: item.image_url }}
                  style={{ width: 60, height: 60, borderRadius: 30, backgroundColor: colors.surfaceMuted }}
                />
              )}
            </View>
            <AppText variant="caption" numberOfLines={1} style={{ marginTop: 6 }}>
              {item.user_id === me ? 'Sen' : taggedName(item.display_name, item.display_tag)}
            </AppText>
          </Pressable>
        ))}
      </ScrollView>

      <Modal visible={Boolean(open)} animationType="fade" onRequestClose={() => setOpen(null)}>
        <Pressable
          onPress={() => setOpen(null)}
          style={{ flex: 1, backgroundColor: '#0E1520', justifyContent: 'center' }}>
          {open ? (
            <View style={{ flex: 1 }}>
              {open.image_url.startsWith('media:') ? (
                <RemoteImage mediaId={open.image_url.slice(6)} style={{ flex: 1 }} />
              ) : (
                <Image source={{ uri: open.image_url }} style={{ flex: 1 }} resizeMode="contain" />
              )}
              <View style={{ position: 'absolute', top: 54, left: 20, right: 20 }}>
                <AppText variant="subtitle" style={{ color: '#F4F1EA' }}>
                  {open.user_id === me ? 'Sen' : taggedName(open.display_name, open.display_tag)}
                </AppText>
                {open.caption ? (
                  <AppText style={{ color: '#F4F1EA', marginTop: 6 }}>{open.caption}</AppText>
                ) : null}
              </View>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}
