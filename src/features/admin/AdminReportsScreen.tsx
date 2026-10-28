import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { AppText } from '@/src/components/ui/AppText';
import { RemoteImage } from '@/src/components/ui/RemoteImage';
import { askConfirm, toastError } from '@/src/components/ui/feedbackStore';
import { adminBtn, adminCard, adminGhost } from '@/src/features/admin/adminUi';
import { mapAdminError } from '@/src/features/admin/roles';
import { useAdminReports } from '@/src/features/admin/useAdmin';
import { useSignedMediaUrl } from '@/src/features/media/useSignedMediaUrl';
import { formatIstanbulDateTime } from '@/src/features/system-exams/examTime';
import { getSupabase } from '@/src/lib/supabase/client';

const STATUS_FILTERS = [
  { id: 'open', label: 'Açık' },
  { id: 'dismissed', label: 'Kapatıldı' },
  { id: 'warned', label: 'Uyarıldı' },
  { id: 'banned', label: 'Yasaklandı' },
] as const;

const TYPE_FILTERS = [
  { id: '', label: 'Tümü' },
  { id: 'dm_message', label: 'Chat' },
  { id: 'status', label: 'Durum' },
  { id: 'comment', label: 'Yorum' },
  { id: 'room_message', label: 'Görsel' },
  { id: 'group_message', label: 'Grup' },
] as const;

const REASON_FILTERS = [
  { id: '', label: 'Tümü' },
  { id: 'spam', label: 'Spam' },
  { id: 'harassment', label: 'Taciz' },
  { id: 'sexual', label: 'Cinsel içerik' },
  { id: 'other', label: 'Diğer' },
] as const;

function textOf(row: Record<string, unknown>, key: string) {
  const value = row[key];
  return value == null ? '' : String(value);
}

function statusLabel(value: string) {
  if (value === 'open') return 'Açık';
  if (value === 'dismissed') return 'Kapatıldı';
  if (value === 'warned') return 'Uyarıldı';
  if (value === 'banned') return 'Yasaklandı';
  if (value === 'restricted') return 'Kısıtlandı';
  return 'Açık';
}

function typeLabel(value: string) {
  if (value === 'dm_message') return 'Chat';
  if (value === 'status') return 'Durum';
  if (value === 'comment') return 'Yorum';
  if (value === 'group_message') return 'Grup';
  if (value === 'room_message') return 'Görsel';
  return 'İçerik';
}

function reasonLabel(value: string) {
  const key = value.trim().toLowerCase();
  if (key.includes('spam')) return 'Spam';
  if (key.includes('harass') || key.includes('taciz')) return 'Taciz';
  if (key.includes('sexual') || key.includes('cinsel')) return 'Cinsel içerik';
  if (key.includes('kufur') || key.includes('küfür')) return 'Küfür / hakaret';
  if (key.includes('siddet') || key.includes('şiddet')) return 'Şiddet';
  if (key.includes('uygunsuz')) return 'Uygunsuz içerik';
  if (key.includes('other') || key.includes('diger') || key.includes('diğer')) return 'Diğer';
  return value ? 'Diğer' : 'Belirtilmedi';
}

function FilterPills({
  items,
  value,
  onChange,
}: {
  items: readonly { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {items.map((item) => {
        const on = value === item.id;
        return (
          <Pressable
            key={item.id || 'all'}
            onPress={() => onChange(item.id)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: on ? '#C45C26' : '#E4DDD0',
              backgroundColor: on ? '#F3E0D4' : '#FFFCF7',
            }}>
            <AppText style={{ color: on ? '#8A3D16' : '#0F1C2E', fontWeight: on ? '700' : '500' }}>{item.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string }> = {
    open: { bg: '#F3E0D4', fg: '#8A3D16' },
    dismissed: { bg: '#EEEAE2', fg: '#57534E' },
    warned: { bg: '#F8EBDD', fg: '#9A3412' },
    banned: { bg: '#FCE8E6', fg: '#B42318' },
    restricted: { bg: '#EEEAE2', fg: '#57534E' },
  };
  const tone = map[status] ?? map.open;
  return (
    <View style={{ backgroundColor: tone.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4 }}>
      <AppText variant="caption" style={{ color: tone.fg, fontWeight: '600' }}>
        {statusLabel(status)}
      </AppText>
    </View>
  );
}

function ReportImage({ mediaId, contentType }: { mediaId: string; contentType: string }) {
  const show = contentType.includes('image') || contentType.includes('dm') || contentType.includes('status');
  const signed = useSignedMediaUrl(show ? mediaId : null);
  if (!show) return null;
  if (signed.data?.url) {
    return <RemoteImage uri={signed.data.url} style={{ width: 160, height: 120, borderRadius: 12 }} resizeMode="contain" />;
  }
  return signed.isError ? (
    <AppText variant="caption" tone="muted">
      Görsel yok veya imza alınamadı.
    </AppText>
  ) : null;
}

export function AdminReportsScreen() {
  const [status, setStatus] = useState('open');
  const [type, setType] = useState('');
  const [reason, setReason] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const reports = useAdminReports(status, type, reason);
  const rows = reports.data ?? [];
  const selected = rows.find((row) => String(row.id) === openId) ?? null;

  const act = (id: string, action: 'dismiss' | 'warning' | 'remove' | 'restrict' | 'ban', label: string, danger?: boolean) => {
    askConfirm({
      title: `${label}?`,
      subtitle: 'Bu işlem kayda yazılır.',
      danger,
      confirmLabel: label,
      onConfirm: () => {
        void getSupabase()
          .rpc('admin_review_report', { p_id: id, p_action: action })
          .then(({ error }) => {
            if (error) toastError(mapAdminError(error.message));
            else {
              setOpenId(null);
              void reports.refetch();
            }
          });
      },
    });
  };

  return (
    <View style={{ gap: 16 }}>
      <View style={{ gap: 4 }}>
        <AppText variant="title">Şikayetler</AppText>
        <AppText tone="muted">Kullanıcı şikayetlerini incele ve gerekli işlemleri uygula.</AppText>
      </View>

      <View style={{ gap: 8 }}>
        <AppText variant="label" tone="muted">
          Durum
        </AppText>
        <FilterPills items={STATUS_FILTERS} value={status} onChange={setStatus} />
      </View>
      <View style={{ gap: 8 }}>
        <AppText variant="label" tone="muted">
          İçerik türü
        </AppText>
        <FilterPills items={TYPE_FILTERS} value={type} onChange={setType} />
      </View>
      <View style={{ gap: 8 }}>
        <AppText variant="label" tone="muted">
          Neden
        </AppText>
        <FilterPills items={REASON_FILTERS} value={reason} onChange={setReason} />
      </View>

      {reports.isError ? (
        <AppText tone="danger">{reports.error instanceof Error ? reports.error.message : 'Liste alınamadı'}</AppText>
      ) : null}
      {reports.isLoading ? <AppText tone="muted">Yükleniyor…</AppText> : null}
      {!reports.isLoading && !reports.isError && rows.length === 0 ? (
        <View style={adminCard}>
          <AppText variant="subtitle">Şikayet yok</AppText>
          <AppText tone="muted">Bu filtrelerde şikayet bulunmuyor.</AppText>
        </View>
      ) : null}

      {rows.map((row) => {
        const id = textOf(row, 'id');
        const created = textOf(row, 'created_at');
        const when = created ? formatIstanbulDateTime(created).label : '—';
        return (
          <View key={id} style={adminCard}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
              <View style={{ flex: 1, gap: 4, minWidth: 0 }}>
                <AppText variant="subtitle" numberOfLines={1}>
                  {textOf(row, 'target') || 'Kullanıcı'}
                </AppText>
                <AppText variant="caption" tone="muted">
                  {typeLabel(textOf(row, 'content_type'))} · {reasonLabel(textOf(row, 'reason'))} · {when}
                </AppText>
                <AppText variant="caption" tone="muted">
                  Bildiren: {textOf(row, 'reporter') || '—'}
                </AppText>
              </View>
              <StatusBadge status={textOf(row, 'status') || status} />
            </View>
            <ReportImage mediaId={textOf(row, 'media_id') || textOf(row, 'content_id')} contentType={textOf(row, 'content_type')} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Pressable onPress={() => setOpenId(id)} style={[adminGhost, { minHeight: 36 }]}>
                <AppText variant="caption">İncele</AppText>
              </Pressable>
              <Pressable onPress={() => act(id, 'warning', 'Uyar')} style={[adminGhost, { minHeight: 36 }]}>
                <AppText variant="caption">Uyar</AppText>
              </Pressable>
              <Pressable onPress={() => act(id, 'ban', 'Yasakla', true)} style={[adminGhost, { minHeight: 36 }]}>
                <AppText variant="caption" tone="danger">
                  Yasakla
                </AppText>
              </Pressable>
              <Pressable onPress={() => act(id, 'dismiss', 'Kapat')} style={[adminGhost, { minHeight: 36 }]}>
                <AppText variant="caption">Kapat</AppText>
              </Pressable>
            </View>
          </View>
        );
      })}

      <Modal visible={Boolean(selected)} transparent animationType="fade" onRequestClose={() => setOpenId(null)}>
        <Pressable
          onPress={() => setOpenId(null)}
          style={{ flex: 1, backgroundColor: 'rgba(15,28,46,0.35)', justifyContent: 'center', padding: 24 }}>
          <Pressable onPress={() => undefined} style={[adminCard, { maxWidth: 520, width: '100%', alignSelf: 'center', gap: 12 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <AppText variant="subtitle">Şikayet detayı</AppText>
              <Pressable onPress={() => setOpenId(null)} hitSlop={8}>
                <Ionicons name="close" size={20} color="#64748B" />
              </Pressable>
            </View>
            {selected ? (
              <>
                <DetailLine label="Şikayet edilen" value={textOf(selected, 'target')} />
                <DetailLine label="Bildiren" value={textOf(selected, 'reporter')} />
                <DetailLine label="Tür" value={typeLabel(textOf(selected, 'content_type'))} />
                <DetailLine label="Neden" value={reasonLabel(textOf(selected, 'reason'))} />
                <DetailLine
                  label="Tarih"
                  value={textOf(selected, 'created_at') ? formatIstanbulDateTime(textOf(selected, 'created_at')).label : '—'}
                />
                <DetailLine label="Durum" value={statusLabel(textOf(selected, 'status') || status)} />
                <DetailLine label="İçerik no" value={textOf(selected, 'content_id') || '—'} />
                <ReportImage
                  mediaId={textOf(selected, 'media_id') || textOf(selected, 'content_id')}
                  contentType={textOf(selected, 'content_type')}
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 4 }}>
                  <Pressable
                    onPress={() => act(textOf(selected, 'id'), 'warning', 'Uyar')}
                    style={[adminGhost, { minHeight: 36 }]}>
                    <AppText variant="caption">Uyar</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => act(textOf(selected, 'id'), 'remove', 'İçeriği kaldır')}
                    style={[adminGhost, { minHeight: 36 }]}>
                    <AppText variant="caption">İçeriği kaldır</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => act(textOf(selected, 'id'), 'restrict', 'Geçici kısıt')}
                    style={[adminGhost, { minHeight: 36 }]}>
                    <AppText variant="caption">Geçici kısıt</AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => act(textOf(selected, 'id'), 'ban', 'Yasakla', true)}
                    style={[adminGhost, { minHeight: 36 }]}>
                    <AppText variant="caption" tone="danger">
                      Yasakla
                    </AppText>
                  </Pressable>
                  <Pressable
                    onPress={() => act(textOf(selected, 'id'), 'dismiss', 'Şikayeti kapat')}
                    style={[adminBtn, { minHeight: 36 }]}>
                    <AppText variant="caption" tone="inverse">
                      Şikayeti kapat
                    </AppText>
                  </Pressable>
                </View>
              </>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function DetailLine({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 2 }}>
      <AppText variant="caption" tone="muted">
        {label}
      </AppText>
      <AppText>{value}</AppText>
    </View>
  );
}
