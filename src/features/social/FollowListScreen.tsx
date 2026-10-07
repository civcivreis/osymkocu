import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Screen } from '@/src/components/ui/Screen';
import { LetterAvatar } from '@/src/features/social/LetterAvatar';
import { taggedName } from '@/src/features/social/identity';
import { useFollowList, useFollowUser, useUnfollowUser } from '@/src/features/social/useFollows';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { useAuthStore } from '@/src/stores/authStore';
import { toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';

export function FollowListScreen() {
  const { colors, spacing } = useAppTheme();
  const params = useLocalSearchParams<{ userId?: string; dir?: string; name?: string }>();
  const userId = String(params.userId ?? '');
  const dir = params.dir === 'following' ? 'following' : 'followers';
  const me = useAuthStore((s) => s.session?.user.id);
  const [search, setSearch] = useState('');
  const list = useFollowList(userId || null, dir, search);
  const follow = useFollowUser();
  const unfollow = useUnfollowUser();

  return (
    <Screen scroll>
      <View style={{ gap: spacing.md }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <AppText variant="subtitle">{dir === 'followers' ? 'Takipçi' : 'Takip'}</AppText>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            minHeight: 46,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.surface,
            borderRadius: 18,
            paddingHorizontal: 12,
          }}>
          <Ionicons name="search" size={18} color={colors.textSubtle} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Kullanıcı ara"
            placeholderTextColor={colors.textSubtle}
            style={{ flex: 1, color: colors.text, fontSize: 16, paddingVertical: 10 }}
          />
        </View>
        {(list.data ?? []).map((person) => {
          const name = taggedName(person.display_name, person.display_tag);
          const mine = person.id === me;
          const following = person.i_follow || person.follow_pending;
          return (
            <View
              key={person.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                padding: 10,
                borderRadius: 18,
                backgroundColor: colors.surface,
                borderWidth: 1,
                borderColor: colors.border,
              }}>
              <Pressable
                onPress={() => router.push({ pathname: '/user', params: { userId: person.id } })}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                <LetterAvatar id={person.id} name={person.display_name} size={44} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <AppText numberOfLines={1} style={{ fontWeight: '700' }}>
                    {name}
                  </AppText>
                  <AppText variant="caption" tone="muted" numberOfLines={1}>
                    {[person.exam_name, person.focus].filter(Boolean).join(' • ') || 'Öğrenci'}
                  </AppText>
                </View>
              </Pressable>
              {mine ? null : (
                <Pressable
                  onPress={() => {
                    const run = following ? unfollow.mutateAsync(person.id) : follow.mutateAsync(person.id);
                    void run.then(undefined, (error: unknown) =>
                      toastError(error),
                    );
                  }}
                  style={{
                    paddingHorizontal: 12,
                    minHeight: 36,
                    borderRadius: 14,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: following ? colors.surfaceMuted : colors.accent,
                    borderWidth: following ? 1 : 0,
                    borderColor: colors.border,
                  }}>
                  <AppText variant="caption" tone={following ? 'primary' : 'inverse'} style={{ fontWeight: '700' }}>
                    {person.follow_pending ? 'İstek' : following ? 'Takiptesin' : 'Takip et'}
                  </AppText>
                </Pressable>
              )}
            </View>
          );
        })}
        {!list.isLoading && (list.data ?? []).length === 0 ? (
          <AppText tone="muted">{dir === 'followers' ? 'Henüz takipçi yok.' : 'Henüz kimseyi takip etmiyor.'}</AppText>
        ) : null}
      </View>
    </Screen>
  );
}
