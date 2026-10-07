import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useState, type ReactNode } from 'react';
import { Platform, Pressable, Switch, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { PageHeader } from '@/src/components/ui/PageHeader';
import { askConfirm, toastError, toastInfo, toastSuccess } from '@/src/components/ui/feedbackStore';
import { Screen } from '@/src/components/ui/Screen';
import { useAuthActions } from '@/src/features/auth/useAuth';
import { useSetExamReminders } from '@/src/features/system-exams/useSystemExams';
import { useCoachStore } from '@/src/features/teacher/coachStore';
import { getSupabase } from '@/src/lib/supabase/client';
import type { Profile, ThemePreference } from '@/src/lib/supabase/types';
import { useBreakpoint } from '@/src/lib/layout/useBreakpoint';
import { useAppTheme } from '@/src/lib/theme/ThemeProvider';
import { disableWebPush, enableWebPush, isWebPushSupported } from '@/src/lib/webPush';
import { useAuthStore } from '@/src/stores/authStore';

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'Sistem' },
  { value: 'light', label: 'Aydınlık' },
  { value: 'dark', label: 'Karanlık' },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <AppText variant="label" tone="muted">
        {title}
      </AppText>
      {children}
    </View>
  );
}

function Row({
  label,
  value,
  onPress,
}: {
  label: string;
  value?: string;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={{
        minHeight: 48,
        paddingHorizontal: 14,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
      }}>
      <AppText style={{ flex: 1 }}>{label}</AppText>
      {value ? (
        <AppText variant="caption" tone="muted" numberOfLines={1} style={{ maxWidth: '52%' }}>
          {value}
        </AppText>
      ) : null}
      {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} /> : null}
    </Pressable>
  );
}

const SETTING_NAVS = [
  { id: 'account', label: 'Hesap' },
  { id: 'appearance', label: 'Görünüm' },
  { id: 'notifications', label: 'Bildirimler' },
  { id: 'matching', label: 'Çalışma Eşleşmesi' },
  { id: 'exam', label: 'Sınav Tercihleri' },
  { id: 'privacy', label: 'Gizlilik ve Güvenlik' },
] as const;

export function SettingsScreen() {
  const { colors, spacing, radius, preference, setPreference } = useAppTheme();
  const { isDesktop } = useBreakpoint();
  const [nav, setNav] = useState<(typeof SETTING_NAVS)[number]['id']>('account');
  const { signOut, deleteAccount } = useAuthActions();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const plan = useAuthStore((s) => s.subscription?.plan ?? 'free');
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');
  const autoMatch = profile?.auto_match !== false;
  const matchNotify = profile?.match_notify !== false;
  const matchSameTopic = profile?.match_same_topic !== false;
  const matchSameSubject = profile?.match_same_subject !== false;
  const email = session?.user.email ?? '—';
  const hintsEnabled = useCoachStore((s) => s.hintsEnabled);
  const setHintsEnabled = useCoachStore((s) => s.setHintsEnabled);
  const examReminders = useSetExamReminders();
  const remindersOn = profile?.system_exam_reminders !== false;

  const patchProfile = async (patch: Partial<Profile>) => {
    if (!profile) return;
    const previous = profile;
    useAuthStore.getState().setProfile({ ...profile, ...patch });
    const { error } = await getSupabase().from('profiles').update(patch).eq('id', profile.id);
    if (error) {
      useAuthStore.getState().setProfile(previous);
      toastError('Eşleşme ayarı kaydedilemedi.');
    }
  };

  const onToggleMatch = async (value: boolean) => {
    await patchProfile({ auto_match: value });
    if (!value) await getSupabase().rpc('leave_presence');
  };

  const onPassword = async () => {
    if (password.length < 8) {
      toastInfo('En az 8 karakter kullan.');
      return;
    }
    if (password !== password2) {
      toastInfo('Şifreler aynı olmalı.');
      return;
    }
    setBusy(true);
    try {
      const { error } = await getSupabase().auth.updateUser({ password });
      if (error) throw error;
      setPassword('');
      setPassword2('');
      toastSuccess('Şifren güncellendi.');
    } catch (error) {
      toastError(error);
    } finally {
      setBusy(false);
    }
  };

  const onSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen scroll>
      <View style={{ gap: spacing.md, paddingBottom: 24 }}>
        <PageHeader title="Ayarlar" />
        {isDesktop ? null : (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Pressable onPress={() => router.back()} hitSlop={12}>
            <Ionicons name="chevron-back" size={26} color={colors.text} />
          </Pressable>
          <AppText variant="subtitle">Ayarlar</AppText>
        </View>
        )}

        <View style={{ flexDirection: isDesktop ? 'row' : 'column', gap: 24, alignItems: 'flex-start' }}>
        {isDesktop ? (
          <View style={{ width: 220, gap: 4 }}>
            {SETTING_NAVS.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => setNav(item.id)}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 12,
                  borderRadius: radius.md,
                  backgroundColor: nav === item.id ? colors.accentMuted : 'transparent',
                }}>
                <AppText tone={nav === item.id ? 'accent' : 'muted'} style={{ fontWeight: '600' }}>
                  {item.label}
                </AppText>
              </Pressable>
            ))}
          </View>
        ) : null}
        <View style={{ flex: 1, gap: spacing.md, width: '100%' }}>

        {!isDesktop || nav === 'account' ? (
        <Section title="HESAP">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Row label="E-posta" value={email} />
            <View style={{ padding: 14, gap: 8 }}>
              <AppText variant="caption" tone="muted">
                Şifre / güvenlik
              </AppText>
              <TextInput
                value={password}
                onChangeText={setPassword}
                placeholder="Yeni şifre"
                secureTextEntry
                placeholderTextColor={colors.textSubtle}
                style={{
                  minHeight: 44,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  color: colors.text,
                }}
              />
              <TextInput
                value={password2}
                onChangeText={setPassword2}
                placeholder="Yeni şifre tekrar"
                secureTextEntry
                placeholderTextColor={colors.textSubtle}
                style={{
                  minHeight: 44,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 14,
                  paddingHorizontal: 12,
                  color: colors.text,
                }}
              />
              <Pressable
                onPress={() => void onPassword()}
                disabled={busy}
                style={{ alignSelf: 'flex-start', paddingVertical: 6 }}>
                <AppText variant="label" tone="accent">
                  Şifreyi güncelle
                </AppText>
              </Pressable>
            </View>
            <Row label="Gizlilik" onPress={() => router.push('/privacy')} />
          </Card>
        </Section>
        ) : null}

        {!isDesktop || nav === 'appearance' ? (
        <Section title="GÖRÜNÜM">
          <Card>
            <AppText variant="subtitle">Tema</AppText>
            <View style={{ flexDirection: 'row', gap: spacing.sm, marginTop: 10 }}>
              {THEME_OPTIONS.map((option) => {
                const active = preference === option.value;
                return (
                  <Pressable
                    key={option.value}
                    onPress={() => setPreference(option.value)}
                    style={{
                      flex: 1,
                      paddingVertical: 10,
                      borderRadius: radius.md,
                      alignItems: 'center',
                      backgroundColor: active ? colors.accentMuted : colors.surfaceMuted,
                      borderWidth: 1,
                      borderColor: active ? colors.accent : colors.border,
                    }}>
                    <AppText variant="caption" tone={active ? 'accent' : 'muted'}>
                      {option.label}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
          </Card>
        </Section>
        ) : null}

        {!isDesktop || nav === 'notifications' ? (
        <Section title="BİLDİRİMLER">
          <Card>
            <Row label="Bildirimler" onPress={() => router.push('/notifications')} />
          </Card>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="subtitle">Sistem sınavı hatırlatmaları</AppText>
                <AppText variant="caption" tone="muted">
                  24 saat, 1 saat ve 10 dakika kala bildirim. Spam yok.
                </AppText>
              </View>
              <Switch
                value={remindersOn}
                onValueChange={(value) => {
                  if (!profile) return;
                  useAuthStore.getState().setProfile({ ...profile, system_exam_reminders: value });
                  void examReminders.mutateAsync(value).catch(() => {
                    useAuthStore.getState().setProfile({ ...profile, system_exam_reminders: !value });
                    toastError('Hatırlatma ayarı kaydedilemedi.');
                  });
                }}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.surface}
              />
            </View>
          </Card>
          {Platform.OS === 'web' ? (
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText variant="subtitle">Web bildirimleri</AppText>
                  <AppText variant="caption" tone="muted">
                    İzin sormadan açılmaz. Native push ile karışmaz.
                  </AppText>
                </View>
                <Switch
                  value={Boolean(profile?.web_push_enabled)}
                  onValueChange={(value) => {
                    if (!isWebPushSupported()) {
                      toastInfo('Bu tarayıcı web bildirimini desteklemiyor.');
                      return;
                    }
                    if (!profile) return;
                    if (value) {
                      void enableWebPush().then((result) => {
                        if (result.ok) {
                          useAuthStore.getState().setProfile({ ...profile, web_push_enabled: true });
                          toastSuccess(result.message);
                        } else toastError(result.message);
                      });
                    } else {
                      void disableWebPush().then(() => {
                        useAuthStore.getState().setProfile({ ...profile, web_push_enabled: false });
                        toastSuccess('Web bildirimleri kapatıldı.');
                      });
                    }
                  }}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.surface}
                />
              </View>
            </Card>
          ) : null}
        </Section>
        ) : null}

        {!isDesktop || nav === 'matching' ? (
        <Section title="ÇALIŞMA EŞLEŞMESİ">
          <Card>
            <View style={{ gap: spacing.md }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <AppText variant="subtitle">Otomatik çalışma eşleşmeleri</AppText>
                  <AppText variant="caption" tone="muted">
                    Aynı ders veya konuyu çalışan öğrencilerle çalışma önerileri al.
                  </AppText>
                </View>
                <Switch
                  value={autoMatch}
                  onValueChange={(value) => void onToggleMatch(value)}
                  trackColor={{ false: colors.border, true: colors.accent }}
                  thumbColor={colors.surface}
                />
              </View>
              {autoMatch ? (
                <>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <AppText>Aynı konudaki öğrenciler</AppText>
                    </View>
                    <Switch
                      value={matchSameTopic}
                      onValueChange={(value) => void patchProfile({ match_same_topic: value })}
                      trackColor={{ false: colors.border, true: colors.accent }}
                      thumbColor={colors.surface}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <AppText>Aynı dersteki öğrenciler</AppText>
                    </View>
                    <Switch
                      value={matchSameSubject}
                      onValueChange={(value) => void patchProfile({ match_same_subject: value })}
                      trackColor={{ false: colors.border, true: colors.accent }}
                      thumbColor={colors.surface}
                    />
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
                    <View style={{ flex: 1, gap: 4 }}>
                      <AppText>Eşleşme bildirimleri</AppText>
                      <AppText variant="caption" tone="muted">
                        Bildirim merkezine eşleşme önerisi düşsün.
                      </AppText>
                    </View>
                    <Switch
                      value={matchNotify}
                      onValueChange={(value) => void patchProfile({ match_notify: value })}
                      trackColor={{ false: colors.border, true: colors.accent }}
                      thumbColor={colors.surface}
                    />
                  </View>
                </>
              ) : null}
            </View>
          </Card>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
              <View style={{ flex: 1, gap: 4 }}>
                <AppText variant="subtitle">Koç ipucu balonu</AppText>
                <AppText variant="caption" tone="muted">
                  Testte 10 saniye takılınca küçük bir yardım önerisi göster.
                </AppText>
              </View>
              <Switch
                value={hintsEnabled}
                onValueChange={setHintsEnabled}
                trackColor={{ false: colors.border, true: colors.accent }}
                thumbColor={colors.surface}
              />
            </View>
          </Card>
        </Section>
        ) : null}

        {!isDesktop || nav === 'exam' ? (
        <>
        <Section title="SINAV TERCİHLERİ">
          <Card style={{ padding: 0, overflow: 'hidden' }}>
            <Row
              label="Sınav türü"
              value={profile?.exam_year ? `${profile.exam_year}` : 'Profili düzenle'}
              onPress={() => router.push('/edit-profile')}
            />
            <Row label="Hedef puan" value={profile?.target_score != null ? String(profile.target_score) : '—'} />
            <Row
              label="Sınav tarihi"
              value={profile?.exam_date ?? (profile?.exam_year ? 'ÖSYM tarihi bekleniyor' : '—')}
            />
          </Card>
        </Section>

        <Section title="PLAN">
          <Card>
            <AppText variant="subtitle">{plan === 'pro' ? 'Pro' : 'Ücretsiz plan'}</AppText>
            <AppText variant="caption" tone="muted" style={{ marginTop: 4 }}>
              Plan yönetimi uygulama içinden henüz açılmadı. Koç ve çalışma akışı mevcut planınla çalışır.
            </AppText>
          </Card>
        </Section>
        </>
        ) : null}

        {!isDesktop || nav === 'privacy' ? (
        <Section title="GİZLİLİK VE GÜVENLİK">
          <Button label="Çıkış yap" variant="danger" loading={busy} onPress={() => void onSignOut()} />
          <Button
            label="Hesabı sil"
            variant="ghost"
            disabled={busy}
            onPress={() =>
              askConfirm({
                title: 'Hesabı sil',
                subtitle: 'Bu işlem geri alınamaz. Emin misin?',
                confirmLabel: 'Sil',
                danger: true,
                onConfirm: () => {
                  void deleteAccount().then(undefined, (error: unknown) => toastError(error, 'Silinemedi'));
                },
              })
            }
          />
        </Section>
        ) : null}
        </View>
        </View>
      </View>
    </Screen>
  );
}
