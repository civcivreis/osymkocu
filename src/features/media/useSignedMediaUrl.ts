import { useQuery } from '@tanstack/react-query';

import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

type Signed = { url: string; expiresAt: number; width?: number | null; height?: number | null };

const memory = new Map<string, Signed>();

export async function fetchSignedMediaUrl(mediaId: string): Promise<Signed> {
  const hit = memory.get(mediaId);
  if (hit && hit.expiresAt > Date.now() + 30_000) return hit;
  const invoked = await getSupabase().functions.invoke('media-url', {
    body: { mediaId },
  });
  const body = invoked.data as
    | { data?: { url?: string; expiresIn?: number; width?: number; height?: number }; error?: { message?: string } }
    | null;
  const url = body?.data?.url;
  if (invoked.error || body?.error || !url) {
    throw new Error(body?.error?.message ?? invoked.error?.message ?? 'Görsel açılamadı.');
  }
  const expiresIn = Math.max(60, Number(body.data?.expiresIn ?? 600));
  const row: Signed = {
    url,
    expiresAt: Date.now() + expiresIn * 1000,
    width: body.data?.width,
    height: body.data?.height,
  };
  memory.set(mediaId, row);
  return row;
}

export function useSignedMediaUrl(mediaId?: string | null) {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery({
    queryKey: ['media-url', mediaId, userId],
    enabled: Boolean(mediaId && userId),
    staleTime: 4 * 60 * 1000,
    queryFn: () => fetchSignedMediaUrl(mediaId!),
  });
}
