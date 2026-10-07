import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import {
  FlatList,
  Image,
  Keyboard,
  Platform,
  Pressable,
  TextInput,
  View,
} from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { ChoiceChip } from '@/src/components/ui/ChoiceChip';
import { fetchSignedMediaUrl } from '@/src/features/media/useSignedMediaUrl';
import { pickDeviceImage } from '@/src/features/media/pickDeviceImage';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { AI_MODES, useTeacher, type TeacherMessage } from '@/src/features/teacher/useTeacher';
import type { AiMode } from '@/src/lib/ai/types';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';

function historyTurns(messages: TeacherMessage[], excludeId?: string) {
  return messages
    .filter((item) => item.id !== 'welcome' && item.id !== excludeId)
    .slice(-24)
    .map((item) => ({ role: item.role, content: item.content }));
}

export function CoachPanel() {
  const { colors, radius, spacing } = useAppTheme();
  const teacher = useTeacher();
  const messages = useCoachStore((s) => s.messages);
  const setMessages = useCoachStore((s) => s.setMessages);
  const [mode, setMode] = useState<AiMode>('simple');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const imageUrl = useCoachStore((s) => (s.screenContext.route === 'chat' ? s.screenContext.imageUrl : undefined));
  const queuedLesson = useCoachStore((s) => s.queuedLesson);

  const send = async (input?: { question?: string; imageBase64?: string; imageUri?: string }) => {
    const typed = (input?.question ?? draft).trim();
    const imageBase64 = input?.imageBase64;
    const appContext = useCoachStore.getState().contextPayload();
    if ((!typed && !imageBase64) || teacher.ask.isPending) return;
    setError(null);
    const userMessage: TeacherMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: typed || 'Soru fotoğrafı',
      imageUri: input?.imageUri ?? appContext.imageUrl ?? undefined,
    };
    setMessages((current) => [...current, userMessage]);
    if (!input?.imageBase64) setDraft('');
    Keyboard.dismiss();
    try {
      const history = historyTurns(useCoachStore.getState().messages, userMessage.id);
      let imageUrl = appContext.imageUrl ?? undefined;
      if (appContext.mediaId) {
        try {
          imageUrl = (await fetchSignedMediaUrl(appContext.mediaId)).url;
        } catch {
          imageUrl = appContext.imageUrl ?? undefined;
        }
      }
      const { result, content } = await teacher.ask.mutateAsync({
        question: typed || 'Bu soruyu sade anlat.',
        mode,
        imageBase64,
        imageUrl,
        imagePath: imageUrl,
        history,
        appContext: { ...appContext, imageUrl, imagePath: imageUrl },
      });
      setMessages((current) => [
        ...current,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content,
          result,
        },
      ]);
    } catch (err) {
      setError(teacher.mapError(err));
    }
  };

  useEffect(() => {
    if (!queuedLesson) return;
    const question = queuedLesson;
    const timer = setTimeout(() => {
      useCoachStore.getState().clearQueuedLesson();
      void send({ question });
    }, 0);
    return () => clearTimeout(timer);
  }, [queuedLesson]);

  const pickFromLibrary = async () => {
    const asset = await pickDeviceImage({ source: 'library', quality: 0.45 });
    if (!asset) return;
    await send({
      question: draft.trim() || 'Bu fotoğraftaki soruyu çöz.',
      imageBase64: asset.base64,
      imageUri: asset.uri,
    });
  };

  const scanQuestion = async () => {
    const asset = await pickDeviceImage({ source: 'camera', quality: 0.45 });
    if (!asset) return;
    await send({
      question: draft.trim() || 'Bu fotoğraftaki soruyu çöz.',
      imageBase64: asset.base64,
      imageUri: asset.uri,
    });
  };

  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <FlatList
        style={{ flex: 1, minHeight: 0 }}
        inverted
        data={[...messages].reverse()}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        contentContainerStyle={{
          paddingHorizontal: spacing.md,
          paddingVertical: spacing.sm,
          gap: spacing.sm,
        }}
        renderItem={({ item }) => (
          <View
            style={{
              alignSelf: item.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '86%',
              backgroundColor: item.role === 'user' ? colors.accentMuted : colors.bg,
              borderColor: colors.border,
              borderWidth: 1,
              borderRadius: radius.lg,
              padding: spacing.md,
              gap: 8,
            }}>
            <AppText variant="caption" tone={item.role === 'user' ? 'accent' : 'muted'}>
              {item.role === 'user' ? 'Sen' : 'Koç'}
            </AppText>
            {item.imageUri ? (
              <Image
                source={{ uri: item.imageUri }}
                style={{ width: 160, height: 160, borderRadius: radius.sm }}
                resizeMode="cover"
              />
            ) : null}
            <AppText>{item.content}</AppText>
          </View>
        )}
        ListHeaderComponent={
          teacher.ask.isPending ? (
            <AppText tone="muted" variant="caption">
              Koç bakıyor…
            </AppText>
          ) : (
            <View style={{ height: 4 }} />
          )
        }
      />

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
          paddingHorizontal: spacing.md,
          paddingTop: spacing.sm,
          paddingBottom: spacing.sm,
          gap: spacing.sm,
        }}>
        <View style={{ flexDirection: 'row', gap: spacing.sm, alignItems: 'center' }}>
          {AI_MODES.map((item) => (
            <ChoiceChip
              key={item.value}
              label={item.label}
              selected={mode === item.value}
              onPress={() => setMode(item.value)}
            />
          ))}
        </View>
        {imageUrl ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Image source={{ uri: imageUrl }} style={{ width: 44, height: 44, borderRadius: 10 }} />
            <AppText variant="caption" tone="muted" style={{ flex: 1 }}>
              Sohbet fotoğrafı Koç’a açık. “Bu soruyu anlat” yazabilirsin.
            </AppText>
          </View>
        ) : null}
        {error ? (
          <AppText tone="danger" variant="caption">
            {error}
          </AppText>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm }}>
          <Pressable
            onPress={() => void scanQuestion()}
            accessibilityLabel="Soruyu tara"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceMuted,
            }}>
            <Ionicons name="scan-outline" size={22} color={colors.accent} />
          </Pressable>
          <Pressable
            onPress={() => void pickFromLibrary()}
            accessibilityLabel="Görsel paylaş"
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.surfaceMuted,
            }}>
            <Ionicons name="image-outline" size={22} color={colors.accent} />
          </Pressable>
          <View
            style={{
              flex: 1,
              minHeight: 44,
              maxHeight: 120,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.md,
              paddingHorizontal: spacing.md,
              paddingVertical: 10,
              backgroundColor: colors.bg,
            }}>
            <TextInput
              placeholder="Takıldığın yeri yaz…"
              placeholderTextColor={colors.textSubtle}
              multiline
              value={draft}
              onChangeText={setDraft}
              style={{ color: colors.text, fontSize: 16, maxHeight: 96 }}
            />
          </View>
          <Pressable
            onPress={() => void send()}
            disabled={!draft.trim() || teacher.ask.isPending}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accent,
              opacity: !draft.trim() || teacher.ask.isPending ? 0.45 : 1,
            }}>
            <Ionicons name="arrow-up" size={22} color={colors.accentText} />
          </Pressable>
        </View>
        {Platform.OS === 'ios' ? <View style={{ height: 4 }} /> : null}
      </View>
    </View>
  );
}
