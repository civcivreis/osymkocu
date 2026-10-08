import { Redirect, Slot, usePathname, router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { SeoHead } from '@/src/features/seo/SeoHead';
import { canManageExams, canManageUsers, canModerate, isStaffRole, isSuperAdmin, mapAdminError } from '@/src/features/admin/roles';
import { useStaffContext } from '@/src/features/admin/useAdmin';
import { isEmailVerified } from '@/src/lib/auth/emailVerification';
import { APP_NAME } from '@/src/lib/brand';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

type NavLink = { href: string; label: string; show: boolean };
type NavSection = { id: string; label: string | null; items: NavLink[] };

export function AdminShell() {
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const staff = useStaffContext();
  const wide = width >= 960;
  const tablet = width >= 720 && width < 960;
  const role = staff.data?.role ?? profile?.app_role;
  const allowed = isStaffRole(role);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (!session) return;
    void getSupabase().rpc('touch_last_active');
    void getSupabase()
      .rpc('dispatch_exam_reminders')
      .then(() => undefined, () => undefined);
  }, [session]);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const sections = useMemo<NavSection[]>(() => {
    return [
      {
        id: 'dash',
        label: null,
        items: [{ href: '/admin', label: 'Dashboard', show: allowed }],
      },
      {
        id: 'content',
        label: 'İÇERİK',
        items: [
          { href: '/admin/mufredat', label: 'Müfredat', show: canManageExams(role) },
          { href: '/admin/hafiza-dersleri', label: 'Hafıza Dersleri', show: canManageExams(role) },
          { href: '/admin/icerik-uretimi', label: 'İçerik Üretimi', show: canManageExams(role) },
          { href: '/admin/questions', label: 'Soru Bankası', show: canManageExams(role) },
          { href: '/admin/exams', label: 'Sistem Sınavları', show: canManageExams(role) },
        ],
      },
      {
        id: 'community',
        label: 'TOPLULUK',
        items: [
          { href: '/admin/users', label: 'Kullanıcılar', show: canManageUsers(role) },
          { href: '/admin/reports', label: 'Şikayetler', show: canModerate(role) },
          { href: '/admin/moderasyon', label: 'Moderasyon', show: canModerate(role) },
          { href: '/admin/sanal-ogrenciler', label: 'Sanal Öğrenciler', show: canManageUsers(role) },
          { href: '/admin/notifications', label: 'Bildirimler', show: canManageUsers(role) },
        ],
      },
      {
        id: 'mgmt',
        label: 'YÖNETİM',
        items: [
          { href: '/admin/team', label: 'Yönetim Ekibi', show: isSuperAdmin(role) },
          { href: '/admin/ai-ayarlari', label: 'AI Ayarları', show: allowed },
          { href: '/admin/stats', label: 'İstatistikler', show: allowed },
          { href: '/admin/settings', label: 'Ayarlar', show: allowed },
        ],
      },
    ];
  }, [allowed, role]);

  if (!session) return <Redirect href="/(auth)/giris" />;
  if (!isEmailVerified(session)) return <Redirect href={'/verify-email' as never} />;
  if (!profile || staff.isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F6F1E8' }}>
        <SeoHead title="ÖSYM Koçu Admin" path="/admin" index={false} />
        <AppText>Yetki kontrol ediliyor…</AppText>
      </View>
    );
  }
  if (staff.isError || !allowed) {
    const message = staff.error instanceof Error ? mapAdminError(staff.error.message) : 'Bu panele erişimin yok.';
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: '#F6F1E8' }}>
        <SeoHead title="Erişim yok" path="/admin" index={false} />
        <AppText variant="title">Erişim yok</AppText>
        <AppText tone="muted" style={{ marginTop: 8, textAlign: 'center' }}>
          {message}
        </AppText>
      </View>
    );
  }

  const navWidth = wide ? 248 : tablet ? 212 : 280;
  const nav = (
    <View style={{ width: navWidth, paddingHorizontal: 16, paddingVertical: 20, gap: 4, backgroundColor: '#FFFCF7', borderRightWidth: 1, borderRightColor: '#E4DDD0', flex: 1 }}>
      <AppText variant="subtitle" style={{ color: '#0F1C2E', marginBottom: 4 }}>
        {APP_NAME} Admin
      </AppText>
      <AppText variant="caption" tone="muted" style={{ marginBottom: 16 }}>
        {profile.display_name}
        {profile.display_tag ? `#${profile.display_tag}` : ''} · {role}
      </AppText>
      {sections.map((section) => {
        const items = section.items.filter((item) => item.show);
        if (items.length === 0) return null;
        return (
          <View key={section.id} style={{ marginBottom: 14, gap: 2 }}>
            {section.label ? (
              <AppText variant="caption" style={{ color: '#94A3B8', letterSpacing: 0.8, paddingHorizontal: 10, paddingBottom: 6 }}>
                {section.label}
              </AppText>
            ) : null}
            {items.map((link) => {
              const active =
                pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
              return (
                <Pressable
                  key={link.href}
                  onPress={() => router.push(link.href as never)}
                  style={{
                    paddingVertical: 10,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: active ? '#F3E0D4' : 'transparent',
                  }}>
                  <AppText style={{ color: '#0F1C2E', fontWeight: active ? '700' : '500' }}>{link.label}</AppText>
                </Pressable>
              );
            })}
          </View>
        );
      })}
    </View>
  );

  return (
    <View style={{ flex: 1, flexDirection: wide || tablet ? 'row' : 'column', backgroundColor: '#F6F1E8' }}>
      <SeoHead title={`${APP_NAME} Admin`} path={pathname} index={false} />
      {wide || tablet ? (
        <View style={{ width: navWidth }}>{nav}</View>
      ) : (
        <View
          style={{
            minHeight: 56,
            paddingHorizontal: 16,
            backgroundColor: '#FFFCF7',
            borderBottomWidth: 1,
            borderBottomColor: '#E4DDD0',
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}>
          <AppText variant="subtitle">{APP_NAME} Admin</AppText>
          <Pressable onPress={() => setMenuOpen((open) => !open)} style={{ padding: 8 }}>
            <AppText tone="accent">{menuOpen ? 'Kapat' : 'Menü'}</AppText>
          </Pressable>
        </View>
      )}
      {!wide && !tablet && menuOpen ? (
        <View style={{ position: 'absolute', left: 0, right: 0, top: 56, bottom: 0, zIndex: 40, flexDirection: 'row' }}>
          <View style={{ width: 280, backgroundColor: '#FFFCF7' }}>
            <ScrollView>{nav}</ScrollView>
          </View>
          <Pressable style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.35)' }} onPress={() => setMenuOpen(false)} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        {wide || tablet ? (
          <View
            style={{
              minHeight: 52,
              paddingHorizontal: 24,
              backgroundColor: '#FFFCF7',
              borderBottomWidth: 1,
              borderBottomColor: '#E4DDD0',
              justifyContent: 'center',
            }}>
            <AppText variant="caption" tone="muted">
              {profile.display_name} · {role}
            </AppText>
          </View>
        ) : null}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: wide ? 28 : 16, gap: 16, minHeight: 600, maxWidth: 1120, width: '100%', alignSelf: 'center' }}>
          <Slot />
        </ScrollView>
      </View>
    </View>
  );
}
