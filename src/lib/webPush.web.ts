import { getSupabase } from '@/src/lib/supabase/client';

function vapidKey() {
  return (process.env.EXPO_PUBLIC_WEB_PUSH_VAPID_KEY ?? '').trim();
}

export function isWebPushSupported() {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function urlBase64ToUint8Array(base64: string) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

export async function enableWebPush(): Promise<{ ok: boolean; message: string }> {
  if (!isWebPushSupported()) {
    return { ok: false, message: 'Bu tarayıcı web bildirimini desteklemiyor.' };
  }
  if (Notification.permission === 'denied') {
    return { ok: false, message: 'Tarayıcı bildirim izni kapalı.' };
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    return { ok: false, message: 'İzin verilmedi. Ayarlardan tekrar açabilirsin.' };
  }
  const key = vapidKey();
  let endpoint = `web-permission:${Date.now()}`;
  let p256dh = '';
  let auth = '';
  if (key) {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    if (reg) {
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(key),
      });
      const json = sub.toJSON();
      endpoint = json.endpoint ?? endpoint;
      p256dh = json.keys?.p256dh ?? '';
      auth = json.keys?.auth ?? '';
    }
  }
  const { error } = await getSupabase().rpc('save_web_push_subscription', {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
  });
  if (error) {
    return { ok: false, message: error.message };
  }
  return {
    ok: true,
    message: key ? 'Web bildirimleri açıldı.' : 'İzin kaydedildi. VAPID anahtarı Phase 4’te gönderimi tamamlar.',
  };
}

export async function disableWebPush(): Promise<void> {
  await getSupabase().rpc('disable_web_push');
}
