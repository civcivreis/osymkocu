import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { pickDeviceImage } from '@/src/features/media/pickDeviceImage';
import { taggedName } from '@/src/features/social/identity';
import { StoryViewer } from '@/src/features/social/StoryViewer';
import { useDeleteStory, usePublishStory, useReportUser, useStories, type StoryItem } from '@/src/features/social/useSocial';
import type { ReportReasonId } from '@/src/features/social/ReportSheet';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';

export function StoriesRail() {
  const { colors } = useAppTheme();
  const me = useAuthStore((s) => s.session?.user.id);
  const stories = useStories();
  const publish = usePublishStory();
  const remove = useDeleteStory();
  const reportUser = useReportUser();
  const [startId, setStartId] = useState<string | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const resumeViewer = useRef(false);
  const startIdRef = useRef<string | null>(null);
  startIdRef.current = startId;
  const [pending, setPending] = useState<{ uri: string; base64: string } | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (resumeViewer.current && startIdRef.current) {
        resumeViewer.current = false;
        setViewerOpen(true);
      }
    }, []),
  );

  const items = stories.data ?? [];
  const rings = useMemo(() => {
    const seen = new Set<string>();
    const list: StoryItem[] = [];
    for (const item of items) {
      if (seen.has(item.user_id)) continue;
      seen.add(item.user_id);
      list.push(item);
    }
    return list;
  }, [items]);

  const addStory = async () => {
    const asset = await pickDeviceImage({ source: 'library', quality: 0.55, aspect: [9, 16], allowsEditing: true });
    if (!asset) return;
    setPending({ uri: asset.uri, base64: asset.base64 });
  };

  const sharePending = async () => {
    if (!pending) return;
    try {
      await publish.mutateAsync({ base64: pending.base64 });
      setPending(null);
      toastSuccess('Story paylaşıldı.');
    } catch (error) {
      toastError(error);
    }
  };

  return (
    <View style={{ width: '100%', alignSelf: 'stretch', minWidth: 0, gap: 8 }}>
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
          <Pressable
            key={item.user_id}
            onPress={() => {
              setStartId(item.id);
              setViewerOpen(true);
            }}
            style={{ alignItems: 'center', width: 72 }}>
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
      {rings.length === 0 ? (
        <AppText variant="caption" tone="muted">
          Henüz story yok. 24 saat görünen bir fotoğraf paylaşabilirsin.
        </AppText>
      ) : null}

      <Modal visible={Boolean(pending)} animationType="fade" transparent onRequestClose={() => setPending(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(14,21,32,0.86)', justifyContent: 'center', padding: 24 }}>
          {pending ? (
            <View style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 16, gap: 12 }}>
              <AppText variant="subtitle">Story paylaş</AppText>
              <Image source={{ uri: pending.uri }} style={{ width: '100%', height: 280, borderRadius: 16 }} resizeMode="cover" />
              <AppText>Seçilen fotoğrafı story olarak paylaşmak istiyor musunuz?</AppText>
              <AppText variant="caption" tone="muted">
                Story 24 saat sonra otomatik silinecek.
              </AppText>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Pressable
                  onPress={() => setPending(null)}
                  style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border }}>
                  <AppText>Vazgeç</AppText>
                </Pressable>
                <Pressable
                  onPress={() => void sharePending()}
                  disabled={publish.isPending}
                  style={{ flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent }}>
                  <AppText tone="inverse">{publish.isPending ? '…' : 'Paylaş'}</AppText>
                </Pressable>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      <StoryViewer
        visible={viewerOpen && Boolean(startId) && items.length > 0}
        stories={items}
        startId={startId}
        onClose={() => {
          setViewerOpen(false);
          setStartId(null);
        }}
        onNavigateAway={(storyId) => {
          resumeViewer.current = true;
          setStartId(storyId);
          setViewerOpen(false);
        }}
        onDelete={async (id) => {
          try {
            await remove.mutateAsync(id);
            toastSuccess('Story silindi.');
          } catch (error) {
            toastError(error);
            throw error;
          }
        }}
        onReport={async (story, reason: ReportReasonId) => {
          try {
            await reportUser.mutateAsync({ otherId: story.user_id, reason });
            toastSuccess('Şikayetin alındı.');
          } catch (error) {
            toastError(error);
            throw error;
          }
        }}
      />
    </View>
  );
}
