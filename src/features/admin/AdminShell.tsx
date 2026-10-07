import { Redirect, Slot, usePathname, router } from 'expo-router';
import { useEffect, useMemo } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { canManageExams, canManageUsers, canModerate, isStaffRole, isSuperAdmin, mapAdminError } from '@/src/features/admin/roles';
import { useStaffContext } from '@/src/features/admin/useAdmin';
import { isEmailVerified } from '@/src/lib/auth/emailVerification';
import { APP_NAME } from '@/src/lib/brand';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

type LinkItem = { href: string; label: string; show: boolean };

export function AdminShell() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const staff = useStaffContext();
  const wide = width >= 900;
  const role = staff.data?.role ?? profile?.app_role;
  const allowed = isStaffRole(role);

  useEffect(() => {
    if (!session) return;
    void getSupabase().rpc('touch_last_active');
    void getSupabase()
      .rpc('dispatch_exam_reminders')
      .then(() => undefined, () => undefined);
  }, [session]);

  const links = useMemo<LinkItem[]>(() => {
    return [
      { href: '/admin', label: 'Dashboard', show: allowed },
      { href: '/admin/exams', label: 'Sistem Sınavları', show: canManageExams(role) },
      { href: '/admin/questions', label: 'Soru Bankası', show: canManageExams(role) },
      { href: '/admin/users', label: 'Kullanıcılar', show: canManageUsers(role) },
      { href: '/admin/reports', label: 'Şikayetler', show: canModerate(role) },
      { href: '/admin/notifications', label: 'Bildirimler', show: canManageUsers(role) },
      { href: '/admin/team', label: 'Yönetim Ekibi', show: isSuperAdmin(role) },
      { href: '/admin/stats', label: 'İstatistikler', show: allowed },
      { href: '/admin/settings', label: 'Ayarlar', show: allowed },
    ];
  }, [allowed, role]);

  if (!session) return <Redirect href="/(auth)/giris" />;
  if (!isEmailVerified(session)) return <Redirect href={'/verify-email' as never} />;
  if (!profile || staff.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEF1F6' }}>
        <SeoHead title="ÖSYM Koçu Admin" path="/admin" index={false} />
        <AppText>Yetki kontrol ediliyor…</AppText>
      </View>
    );
  }
  if (staff.isError || !allowed) {
    const message = staff.error instanceof Error ? mapAdminError(staff.error.message) : 'Bu panele erişimin yok.';
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#EEF1F6' }}>
        <SeoHead title="Erişim yok" path="/admin" index={false} />
        <AppText variant="title">Access denied</AppText>
        <AppText tone="muted" style={{ marginTop: 8, textAlign: 'center' }}>{message}</AppText>
      </View>
    );
  }

  const nav = (
    <View style={{ width: wide ? 228 : undefined, padding: 16, gap: 4, backgroundColor: '#1A2332' }}>
      <AppText variant="label" style={{ color: '#D8DEE9', marginBottom: 10 }}>
        {APP_NAME} Admin
      </AppText>
      {links.filter((link) => link.show).map((link) => {
        const active = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
        return (
          <Pressable
            key={link.href}
            onPress={() => router.push(link.href as never)}
            style={{ paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10, backgroundColor: active ? '#3D4F66' : 'transparent' }}>
            <AppText style={{ color: '#F7F8FA', fontWeight: active ? '700' : '500' }}>{link.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', backgroundColor: '#EEF1F6' }}>
      <SeoHead title={`${APP_NAME} Admin`} path={pathname} index={false} />
      {wide ? nav : <ScrollView horizontal style={{ maxHeight: 64, backgroundColor: '#1A2332' }}>{nav}</ScrollView>}
      <View style={{ flex: 1 }}>
        <View style={{ minHeight: 52, paddingHorizontal: 20, backgroundColor: '#F7F8FA', borderBottomWidth: 1, borderBottomColor: '#D9DEE7', justifyContent: 'center' }}>
          <AppText variant="caption" tone="muted">
            {profile.display_name} · {role}
          </AppText>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 24, gap: 16, minHeight: 600 }}>
          <Slot />
        </ScrollView>
      </View>
    </View>
  );
}
