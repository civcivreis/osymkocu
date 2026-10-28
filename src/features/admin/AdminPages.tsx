import { useEffect, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { askConfirm, toastError, toastSuccess } from '@/src/components/ui/feedbackStore';
import { getLevelFromXp } from '@/src/features/progress/xp';
import { formatIstanbulDateTime } from '@/src/features/system-exams/examTime';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAdminStats, useAdminUsers } from '@/src/features/admin/useAdmin';
import { mapAdminError } from '@/src/features/admin/roles';

export function AdminDashboardScreen() {
  const stats = useAdminStats();
  const row = stats.data ?? {};
  const upcoming = row.upcoming_exam as { title?: string; start_at?: string } | null;
  return (
    <View style={{ gap: 12 }}>
      <AppText variant="title">Dashboard</AppText>
      {stats.isError ? (
        <AppText tone="danger">{stats.error instanceof Error ? stats.error.message : 'İstatistik alınamadı.'}</AppText>
      ) : null}
      <Grid items={[
        ['Koç oturumu (insan)', String((row.coach as { human_sessions?: number } | undefined)?.human_sessions ?? '—')],
        ['Koç oturumu (sanal)', String((row.coach as { virtual_sessions?: number } | undefined)?.virtual_sessions ?? '—')],
        ['Yanlış toparlama', String((row.coach as { recovery_rate?: number } | undefined)?.recovery_rate ?? '—')],
        ['Ort. oturum dk', String((row.coach as { avg_session_minutes?: number } | undefined)?.avg_session_minutes ?? '—')],
        ['Toplam kullanıcı', String(row.users ?? '—')],
        ['Bugün aktif', String(row.today_active_users ?? '—')],
        ['Bugün çözülen soru', String(row.questions_today ?? '—')],
        ['Aktif çalışma oturumu', String(row.active_sessions ?? '—')],
        ['Açık çalışma odaları', String(row.open_rooms ?? '—')],
        ['Bekleyen şikayet', String(row.pending_reports ?? '—')],
      ]} />
      {upcoming?.title ? (
        <AppText>Yaklaşan sistem sınavı: {upcoming.title} · {upcoming.start_at ? formatIstanbulDateTime(upcoming.start_at).label : ''}</AppText>
      ) : (
        <AppText tone="muted">Yaklaşan sistem sınavı yok.</AppText>
      )}
    </View>
  );
}

export function AdminUsersScreen() {
  const [search, setSearch] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const users = useAdminUsers(search);

  const loadDetail = (id: string) => {
    setDetailId(id);
    void getSupabase()
      .rpc('admin_get_user', { p_user: id })
      .then(({ data, error }) => {
        if (error) toastError(mapAdminError(error.message));
        else setDetail(data as Record<string, unknown>);
      });
  };

  const setStatus = (userId: string, status: string, hours?: number) => {
    askConfirm({
      title: status === 'banned' ? 'Kullanıcı yasaklansın mı?' : 'Durum güncellensin mi?',
      subtitle: status,
      danger: status === 'banned',
      confirmLabel: 'Uygula',
      onConfirm: () => {
        void getSupabase()
          .rpc('admin_set_user_status', { p_user: userId, p_status: status, p_hours: hours ?? 48 })
          .then(({ error }) => {
            if (error) toastError(mapAdminError(error.message));
            else {
              toastSuccess('Audit log’a yazıldı');
              void users.refetch();
            }
          });
      },
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <AppText variant="title">Kullanıcılar</AppText>
      <TextInput value={search} onChangeText={setSearch} placeholder="İsim ara" style={field} />
      {users.isError ? <AppText tone="danger">{users.error instanceof Error ? users.error.message : 'Liste alınamadı'}</AppText> : null}
      {(users.data ?? []).map((user) => (
        <View key={String(user.id)} style={card}>
          <Pressable onPress={() => loadDetail(String(user.id))}>
            <AppText variant="subtitle">{String(user.username ?? user.display_name)}</AppText>
            <AppText variant="caption" tone="muted">
              {String(user.exam_name ?? '—')} · Lv.{getLevelFromXp(Number(user.current_xp ?? 0))} · {String(user.current_xp)} XP · streak {String(user.streak ?? 0)} · {String(user.app_role)} · {String(user.account_status)}
            </AppText>
            <AppText variant="caption" tone="muted">
              kayıt {String(user.created_at ?? '').slice(0, 10)} · son aktif {user.last_active_at ? String(user.last_active_at).slice(0, 16) : '—'}
            </AppText>
          </Pressable>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 }}>
            <Pressable onPress={() => setStatus(String(user.id), 'warned')}><AppText variant="caption" tone="accent">Uyarı</AppText></Pressable>
            <Pressable onPress={() => setStatus(String(user.id), 'restricted', 48)}><AppText variant="caption" tone="accent">Geçici kısıt</AppText></Pressable>
            <Pressable onPress={() => setStatus(String(user.id), 'banned')}><AppText variant="caption" tone="danger">Ban</AppText></Pressable>
            <Pressable onPress={() => setStatus(String(user.id), 'active')}><AppText variant="caption">Unban</AppText></Pressable>
          </View>
        </View>
      ))}
      {detail && detailId ? (
        <View style={card}>
          <AppText variant="subtitle">Detay</AppText>
          <AppText variant="caption">Test sayısı: {String((detail as { attempts?: number }).attempts ?? 0)}</AppText>
          <AppText variant="caption">Şikayet: {Array.isArray((detail as { reports?: unknown[] }).reports) ? (detail as { reports: unknown[] }).reports.length : 0}</AppText>
          <AppText variant="caption">Oturum: {Array.isArray((detail as { sessions?: unknown[] }).sessions) ? (detail as { sessions: unknown[] }).sessions.length : 0}</AppText>
        </View>
      ) : null}
    </View>
  );
}

export { AdminReportsScreen } from '@/src/features/admin/AdminReportsScreen';

export function AdminNotificationsScreen() {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [examType, setExamType] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [deepLink, setDeepLink] = useState('');
  const [scheduled, setScheduled] = useState('');

  const send = () => {
    askConfirm({
      title: 'Bildirim gönderilsin mi?',
      subtitle: examType ? `${examType.toUpperCase()} hedefi` : userId ? 'Tek kullanıcı' : 'Tüm kullanıcılar',
      confirmLabel: 'Gönder',
      danger: !examType && !userId,
      onConfirm: () => {
        void getSupabase()
          .rpc('admin_broadcast', {
            p_body: body,
            p_exam_type: examType,
            p_title: title || null,
            p_target_user: userId || null,
            p_deep_link: deepLink || null,
            p_scheduled_at: scheduled || null,
          })
          .then(({ data, error }) => {
            if (error) toastError(mapAdminError(error.message));
            else {
              const sent = (data as { sent?: number; queued?: boolean })?.sent;
              toastSuccess((data as { queued?: boolean })?.queued ? 'Zamanlandı' : `${sent ?? 0} kişi`);
            }
          });
      },
    });
  };

  return (
    <View style={{ gap: 12 }}>
      <AppText variant="title">Bildirimler</AppText>
      <TextInput value={title} onChangeText={setTitle} placeholder="Başlık" style={field} />
      <TextInput value={body} onChangeText={setBody} placeholder="Mesaj" style={[field, { minHeight: 80 }]} multiline />
      <TextInput value={deepLink} onChangeText={setDeepLink} placeholder="Deep link (isteğe bağlı)" style={field} />
      <TextInput value={userId} onChangeText={setUserId} placeholder="Belirli kullanıcı UUID (isteğe bağlı)" style={field} />
      <TextInput value={scheduled} onChangeText={setScheduled} placeholder="Zamanla ISO (isteğe bağlı)" style={field} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {[null, 'tyt', 'ayt', 'kpss'].map((item) => (
          <Pressable key={String(item)} onPress={() => setExamType(item)}>
            <AppText tone={examType === item ? 'accent' : 'muted'}>{item ? item.toUpperCase() : 'Tümü'}</AppText>
          </Pressable>
        ))}
      </View>
      <Pressable onPress={send} style={btn}>
        <AppText tone="inverse">Onayla ve gönder</AppText>
      </Pressable>
    </View>
  );
}

export function AdminStatsScreen() {
  return <AdminDashboardScreen />;
}

export function AdminSettingsScreen() {
  const [countdown, setCountdown] = useState('10');
  const [pairMatch, setPairMatch] = useState(true);
  const [searchSec, setSearchSec] = useState('12');
  const [waitSec, setWaitSec] = useState('75');
  const [graceSec, setGraceSec] = useState('75');
  const [eventsOn, setEventsOn] = useState(true);
  const [motivOn, setMotivOn] = useState(true);
  const [topicShare, setTopicShare] = useState(true);
  useEffect(() => {
    void getSupabase()
      .from('app_runtime_settings')
      .select(
        'default_next_lesson_countdown, pair_match_enabled, match_search_seconds, paired_question_wait_seconds, pair_reconnect_grace_seconds, pair_study_events_enabled, pair_motivation_enabled, pair_topic_share_enabled',
      )
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        const row = data as Record<string, unknown> | null;
        const value = Number(row?.default_next_lesson_countdown);
        if (Number.isFinite(value)) setCountdown(String(value));
        if (row) {
          setPairMatch(row.pair_match_enabled !== false);
          if (row.match_search_seconds != null) setSearchSec(String(row.match_search_seconds));
          if (row.paired_question_wait_seconds != null) setWaitSec(String(row.paired_question_wait_seconds));
          if (row.pair_reconnect_grace_seconds != null) setGraceSec(String(row.pair_reconnect_grace_seconds));
          setEventsOn(row.pair_study_events_enabled !== false);
          setMotivOn(row.pair_motivation_enabled !== false);
          setTopicShare(row.pair_topic_share_enabled !== false);
        }
      });
  }, []);
  return (
    <View style={{ gap: 10 }}>
      <AppText variant="title">Ayarlar</AppText>
      <AppText tone="muted">
        Sistem sınavı saati rastgele üretilmez. Europe/Istanbul slotları: 20:00, 20:30, 21:00, 21:30, 22:00.
      </AppText>
      <AppText variant="label">Sıradaki derse geçiş sayacı (sn)</AppText>
      <TextInput value={countdown} onChangeText={setCountdown} placeholder="10" style={field} />
      <Pressable
        onPress={() => {
          const value = Math.min(30, Math.max(5, Number(countdown) || 10));
          void getSupabase()
            .from('app_runtime_settings')
            .update({ default_next_lesson_countdown: value, updated_at: new Date().toISOString() })
            .eq('id', 1)
            .then(({ error }) => {
              if (error) toastError(mapAdminError(error.message));
              else {
                setCountdown(String(value));
                toastSuccess('Sayaç kaydedildi');
              }
            });
        }}
        style={btn}>
        <AppText style={{ color: '#fff' }}>Kaydet</AppText>
      </Pressable>
      <AppText variant="subtitle">Eşleşmeli ders</AppText>
      <Pressable onPress={() => setPairMatch((value) => !value)}>
        <AppText>Eşleşme {pairMatch ? 'açık' : 'kapalı'}</AppText>
      </Pressable>
      <AppText variant="label">Arama süresi (sn)</AppText>
      <TextInput value={searchSec} onChangeText={setSearchSec} style={field} keyboardType="number-pad" />
      <AppText variant="label">Cevap bekleme (sn)</AppText>
      <TextInput value={waitSec} onChangeText={setWaitSec} style={field} keyboardType="number-pad" />
      <AppText variant="label">Yeniden bağlanma payı (sn)</AppText>
      <TextInput value={graceSec} onChangeText={setGraceSec} style={field} keyboardType="number-pad" />
      <Pressable onPress={() => setEventsOn((value) => !value)}>
        <AppText>Otomatik çalışma mesajları {eventsOn ? 'açık' : 'kapalı'}</AppText>
      </Pressable>
      <Pressable onPress={() => setMotivOn((value) => !value)}>
        <AppText>Motivasyon mesajları {motivOn ? 'açık' : 'kapalı'}</AppText>
      </Pressable>
      <Pressable onPress={() => setTopicShare((value) => !value)}>
        <AppText>Konu durum paylaşımı {topicShare ? 'açık' : 'kapalı'}</AppText>
      </Pressable>
      <Pressable
        onPress={() => {
          void getSupabase()
            .rpc('admin_set_pair_study_settings', {
              p_match_enabled: pairMatch,
              p_search_seconds: Math.min(30, Math.max(8, Number(searchSec) || 12)),
              p_wait_seconds: Math.min(180, Math.max(30, Number(waitSec) || 75)),
              p_grace_seconds: Math.min(180, Math.max(30, Number(graceSec) || 75)),
              p_events: eventsOn,
              p_motivation: motivOn,
              p_topic_share: topicShare,
            })
            .then(({ error }) => {
              if (error) toastError(mapAdminError(error.message));
              else toastSuccess('Eşleşme ayarları kaydedildi');
            });
        }}
        style={btn}>
        <AppText style={{ color: '#fff' }}>Eşleşme ayarlarını kaydet</AppText>
      </Pressable>
      <AppText variant="caption" tone="muted">
        Service role tarayıcıya konmaz. Rol değişimi yalnızca super_admin RPC ile yapılır.
      </AppText>
    </View>
  );
}

function Grid({ items }: { items: [string, string][] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
      {items.map(([label, value]) => (
        <View key={label} style={{ width: 180, backgroundColor: '#FFFCF7', borderRadius: 16, padding: 12, borderWidth: 1, borderColor: '#E4DDD0' }}>
          <AppText variant="caption" tone="muted">{label}</AppText>
          <AppText variant="title">{value}</AppText>
        </View>
      ))}
    </View>
  );
}

const field = { minHeight: 44, borderWidth: 1, borderColor: '#D9DEE7', borderRadius: 12, paddingHorizontal: 12, backgroundColor: '#fff' } as const;
const card = { backgroundColor: '#F7F8FA', borderRadius: 14, padding: 12, gap: 4, borderWidth: 1, borderColor: '#D9DEE7' } as const;
const btn = { minHeight: 44, borderRadius: 12, backgroundColor: '#3D4F66', alignItems: 'center' as const, justifyContent: 'center' as const, paddingHorizontal: 16 } as const;
