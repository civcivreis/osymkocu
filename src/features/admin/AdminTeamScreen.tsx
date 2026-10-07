import { useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { mapAdminError } from '@/src/features/admin/roles';
import { useAdminStaff } from '@/src/features/admin/useAdmin';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

export function AdminTeamScreen() {
  const me = useAuthStore((s) => s.profile?.id);
  const staff = useAdminStaff();
  const [userId, setUserId] = useState('');

  const setRole = (id: string, role: 'user' | 'moderator' | 'admin') => {
    if (id === me) {
      toastError('Kendini düşüremezsin.');
      return;
    }
    askConfirm({
      title: role === 'user' ? 'Rol kaldırılsın mı?' : `${role} eklensin mi?`,
      danger: role === 'user',
      confirmLabel: 'Uygula',
      onConfirm: () => {
        void getSupabase()
          .rpc('admin_set_staff_role', { p_user: id, p_role: role })
          .then(({ error }) => {
            if (error) toastError(mapAdminError(error.message));
            else {
              toastSuccess('Rol güncellendi');
              void staff.refetch();
            }
          });
      },
    });
  };

  if (staff.isError) {
    return <AppText tone="danger">{staff.error instanceof Error ? staff.error.message : 'Yalnızca süper admin'}</AppText>;
  }

  return (
    <View style={{ gap: 12 }}>
      <AppText variant="title">Yönetim Ekibi</AppText>
      <TextInput value={userId} onChangeText={setUserId} placeholder="Kullanıcı UUID" style={field} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <Pressable onPress={() => userId && setRole(userId, 'moderator')}><AppText tone="accent">Moderatör ekle</AppText></Pressable>
        <Pressable onPress={() => userId && setRole(userId, 'admin')}><AppText tone="accent">Admin ekle</AppText></Pressable>
      </View>
      {(staff.data ?? []).map((row) => (
        <View key={String(row.id)} style={card}>
          <AppText variant="subtitle">{String(row.username ?? row.display_name)}</AppText>
          <AppText variant="caption" tone="muted">
            {String(row.app_role)} · ekleyen {String(row.added_by ?? '—')} · {String(row.created_at ?? '').slice(0, 10)}
          </AppText>
          {row.app_role !== 'super_admin' ? (
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 6 }}>
              {row.app_role !== 'moderator' ? (
                <Pressable onPress={() => setRole(String(row.id), 'moderator')}><AppText variant="caption">Moderatör yap</AppText></Pressable>
              ) : null}
              {row.app_role !== 'admin' ? (
                <Pressable onPress={() => setRole(String(row.id), 'admin')}><AppText variant="caption">Admin yap</AppText></Pressable>
              ) : null}
              <Pressable onPress={() => setRole(String(row.id), 'user')}><AppText variant="caption" tone="danger">Rolü kaldır</AppText></Pressable>
            </View>
          ) : (
            <AppText variant="caption" tone="muted">Süper admin korunur.</AppText>
          )}
        </View>
      ))}
    </View>
  );
}

const field = { minHeight: 44, borderWidth: 1, borderColor: '#D9DEE7', borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#fff' } as const;
const card = { backgroundColor: '#F7F8FA', borderRadius: 14, padding: 12, gap: 4, borderWidth: 1, borderColor: '#D9DEE7' } as const;
