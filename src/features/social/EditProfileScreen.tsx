import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { ChoiceChip } from '@/src/components/ui/ChoiceChip';
import { Screen } from '@/src/components/ui/Screen';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { pickDeviceImage } from '@/src/features/media/pickDeviceImage';
import { useProfileCard } from '@/src/features/social/useFollows';
import { useExams, useSubjects } from '@/src/features/onboarding/useCatalog';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

function decodeBase64(value: string) {
  const chars = globalThis.atob(value);
  const bytes = new Uint8Array(chars.length);
  for (let i = 0; i < chars.length; i += 1) bytes[i] = chars.charCodeAt(i);
  return bytes;
}

export function EditProfileScreen() {
  const { colors, spacing } = useAppTheme();
  const client = useQueryClient();
  const profile = useAuthStore((s) => s.profile);
  const card = useProfileCard(profile?.id ?? null);
  const exams = useExams();
  const [name, setName] = useState(profile?.display_name ?? '');
  const [bio, setBio] = useState('');
  const [examId, setExamId] = useState(profile?.exam_id ?? '');
  const [picked, setPicked] = useState<string[]>([]);
  const [avatarUrl, setAvatarUrl] = useState(profile?.avatar_url ?? null);
  const [busy, setBusy] = useState(false);
  const exam = useMemo(() => (exams.data ?? []).find((item) => item.id === examId) ?? null, [examId, exams.data]);
  const subjects = useSubjects(exam);
  const settings = useQuery({
    queryKey: ['exam-settings', profile?.id],
    enabled: Boolean(profile?.id),
    queryFn: async () => {
      const { data, error } = await getSupabase()
        .from('user_exam_settings')
        .select('perceived_weak_subject_ids')
        .eq('user_id', profile!.id)
        .maybeSingle();
      if (error) throw error;
      return (data?.perceived_weak_subject_ids ?? []) as string[];
    },
  });

  useEffect(() => {
    if (card.data?.bio) setBio(card.data.bio);
    if (card.data?.avatar_url) setAvatarUrl(card.data.avatar_url);
  }, [card.data?.avatar_url, card.data?.bio]);

  useEffect(() => {
    if (settings.data?.length) setPicked(settings.data);
  }, [settings.data]);

  const toggleSubject = (id: string) => {
    setPicked((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  };

  const onPickPhoto = async () => {
    const asset = await pickDeviceImage({ source: 'library', quality: 0.7, aspect: [1, 1], allowsEditing: true });
    if (!asset?.base64 || !profile) return;
    setBusy(true);
    try {
      const path = `${profile.id}/${Date.now()}.jpg`;
      const bytes = decodeBase64(asset.base64);
      let upload = await getSupabase().storage.from('avatars').upload(path, bytes, {
        contentType: 'image/jpeg',
        upsert: true,
      });
      if (upload.error) {
        upload = await getSupabase().storage.from('stories').upload(`avatar-${path}`, bytes, {
          contentType: 'image/jpeg',
          upsert: true,
        });
        if (upload.error) throw upload.error;
        const { data } = getSupabase().storage.from('stories').getPublicUrl(`avatar-${path}`);
        setAvatarUrl(data.publicUrl);
      } else {
        const { data } = getSupabase().storage.from('avatars').getPublicUrl(path);
        setAvatarUrl(data.publicUrl);
      }
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const onSave = async () => {
    if (!profile) return;
    const display = name.trim();
    if (display.length < 2) {
      toastInfo('En az 2 karakter yaz.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await getSupabase()
        .from('profiles')
        .update({
          display_name: display,
          bio: bio.trim() || null,
          exam_id: examId || profile.exam_id,
          avatar_url: avatarUrl,
        })
        .eq('id', profile.id);
      if (error) throw error;
      const weak = picked.slice(0, 8);
      if (examId || profile.exam_id) {
        await getSupabase().from('user_exam_settings').upsert(
          {
            user_id: profile.id,
            exam_id: examId || profile.exam_id,
            perceived_weak_subject_ids: weak,
          },
          { onConflict: 'user_id' },
        );
      }
      useAuthStore.getState().setProfile({
        ...profile,
        display_name: display,
        exam_id: examId || profile.exam_id,
        avatar_url: avatarUrl,
      });
      void client.invalidateQueries({ queryKey: ['profile-card'] });
      void client.invalidateQueries({ queryKey: ['exam-settings'] });
      router.back();
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <View style={{ gap: spacing.md, paddingBottom: 24 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <AppText variant="subtitle">Profili düzenle</AppText>
        </View>

        <Pressable onPress={() => void onPickPhoto()} style={{ alignSelf: 'center', alignItems: 'center', gap: 6 }}>
          <LetterAvatar id={profile?.id ?? 'me'} name={name} size={88} imageUrl={avatarUrl} />
          <AppText variant="label" tone="accent">
            Fotoğrafı değiştir
          </AppText>
        </Pressable>

        <AppText variant="label" tone="muted">
          Kullanıcı adı
        </AppText>
        <TextInput
          value={name}
          onChangeText={setName}
          style={{
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            paddingHorizontal: 14,
            color: colors.text,
            backgroundColor: colors.surface,
          }}
        />
        <AppText variant="label" tone="muted">
          Bio
        </AppText>
        <TextInput
          value={bio}
          onChangeText={setBio}
          placeholder="Kısa odak / hakkında"
          placeholderTextColor={colors.textSubtle}
          style={{
            minHeight: 48,
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 16,
            paddingHorizontal: 14,
            color: colors.text,
            backgroundColor: colors.surface,
          }}
        />

        <AppText variant="label" tone="muted">
          Sınav türü
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(exams.data ?? []).map((item) => (
            <ChoiceChip
              key={item.id}
              label={item.name}
              selected={examId === item.id}
              onPress={() => {
                setExamId(item.id);
                setPicked([]);
              }}
            />
          ))}
        </View>

        <AppText variant="label" tone="muted">
          Çalıştığı dersler
        </AppText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(subjects.data ?? []).map((subject) => (
            <ChoiceChip
              key={subject.id}
              label={subject.name}
              selected={picked.includes(subject.id)}
              onPress={() => toggleSubject(subject.id)}
            />
          ))}
        </View>

        <Button label="Kaydet" loading={busy} onPress={() => void onSave()} />
      </View>
    </Screen>
  );
}
