import { getSupabase } from '@/src/lib/supabase/client';

export const CHAT_CLUSTER_MS = 3 * 60 * 1000;
export const CHAT_IMAGE_MAX = 240;

export type ChatKind = 'text' | 'image';

export type ChatMedia = {
  kind?: string | null;
  image_path?: string | null;
  image_width?: number | null;
  image_height?: number | null;
  media_id?: string | null;
};

export type Clusterable = {
  sender_id: string;
  created_at: string;
};

export function isImageMessage(row: ChatMedia | null | undefined) {
  return Boolean(row?.media_id) || Boolean(row?.image_path) || row?.kind === 'image';
}

export function chatPreview(row: { body?: string | null } & ChatMedia) {
  if (isImageMessage(row)) {
    const cap = (row.body ?? '').trim();
    return cap ? `📷 ${cap}` : 'Fotoğraf';
  }
  return (row.body ?? '').trim();
}

export function sameCluster(a?: Clusterable | null, b?: Clusterable | null, gap = CHAT_CLUSTER_MS) {
  if (!a || !b) return false;
  if (a.sender_id !== b.sender_id) return false;
  const left = Date.parse(a.created_at);
  const right = Date.parse(b.created_at);
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  return Math.abs(left - right) < gap;
}

export function chatImageUrl(path?: string | null) {
  if (!path) return null;
  if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('file:')) return path;
  const { data } = getSupabase().storage.from('chat-images').getPublicUrl(path);
  return data.publicUrl || null;
}

export function imageBox(width?: number | null, height?: number | null, max = CHAT_IMAGE_MAX) {
  const w = width && width > 0 ? width : max;
  const h = height && height > 0 ? height : Math.round(max * 0.75);
  const scale = Math.min(max / w, (max * 1.35) / h, 1);
  return {
    width: Math.max(120, Math.round(w * scale)),
    height: Math.max(90, Math.round(h * scale)),
  };
}

type MediaUploadError = { code?: string; reason?: string; message?: string };
type MediaUploadBody = {
  data?: { mediaId?: string; width?: number | null; height?: number | null };
  error?: MediaUploadError;
};

async function readUploadError(invoked: { data: unknown; error: { message?: string; context?: unknown } | null }) {
  const body = invoked.data as MediaUploadBody | null;
  if (body?.error) return body.error;
  const context = invoked.error?.context as { json?: () => Promise<unknown> } | undefined;
  if (context && typeof context.json === 'function') {
    try {
      const parsed = (await context.json()) as MediaUploadBody;
      if (parsed?.error) return parsed.error;
    } catch {
      // ignore
    }
  }
  return { code: invoked.error?.message || 'IMAGE_REJECTED' };
}

export async function uploadChatImage(input: {
  userId?: string;
  base64: string;
  mime?: string;
  width?: number;
  height?: number;
  conversationId?: string | null;
  otherUserId?: string | null;
  groupSlug?: string | null;
}) {
  const supabase = getSupabase();
  void input.userId;
  const invoked = await supabase.functions.invoke('media-upload', {
    body: {
      purpose: 'chat_image',
      conversationId: input.conversationId ?? undefined,
      otherUserId: input.otherUserId ?? undefined,
      groupSlug: input.groupSlug ?? undefined,
      base64: input.base64,
      mime: input.mime ?? 'image/jpeg',
      width: input.width ?? null,
      height: input.height ?? null,
    },
  });
  const body = invoked.data as MediaUploadBody | null;
  if (invoked.error || body?.error || !body?.data?.mediaId) {
    const err = await readUploadError(invoked);
    const raw = [err.code, err.reason, err.message].filter(Boolean).join(' ');
    throw new Error(moderationUserMessage(raw || 'IMAGE_REJECTED'));
  }
  return {
    mediaId: body.data.mediaId,
    width: body.data.width ?? input.width ?? null,
    height: body.data.height ?? input.height ?? null,
  };
}

export function moderationUserMessage(raw: string) {
  if (/IMAGE_RESTRICTED/i.test(raw)) return 'Şu an fotoğraf gönderemezsin. Bir süre sonra dene.';
  if (/IMAGE_MODERATION_UNAVAILABLE|moderation_unavailable/i.test(raw)) {
    return 'Görsel şu anda kontrol edilemedi. Lütfen tekrar dene.';
  }
  if (/IMAGE_REJECTED|IMAGE_NOT_APPROVED|BAD_IMAGE|unsafe_content/i.test(raw)) {
    return 'Bu görsel topluluk kurallarına uygun olmadığı için gönderilemedi.';
  }
  if (/schema cache|could not find|media-upload|R2_/i.test(raw)) {
    return 'Fotoğraf gönderilemedi. Biraz sonra tekrar dene.';
  }
  return raw;
}
