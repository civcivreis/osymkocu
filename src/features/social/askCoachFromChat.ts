import { fetchSignedMediaUrl } from '@/src/features/media/useSignedMediaUrl';
import { useCoachStore } from '@/src/features/teacher/coachStore';

export async function askCoachFromChat(input: {
  mediaId?: string | null;
  imageUrl?: string | null;
  caption?: string | null;
  where: string;
}) {
  let imageUrl = input.imageUrl ?? null;
  if (input.mediaId) {
    try {
      imageUrl = (await fetchSignedMediaUrl(input.mediaId)).url;
    } catch {
      imageUrl = imageUrl ?? null;
    }
  }
  if (!imageUrl && !input.mediaId) return;
  useCoachStore.getState().setScreenContext({
    route: 'chat',
    mediaId: input.mediaId ?? undefined,
    imageUrl: imageUrl ?? undefined,
    imagePath: imageUrl ?? undefined,
    questionText: input.caption?.trim() || 'Sohbet fotoğrafı',
    lessonProgress: input.where,
  });
  useCoachStore.getState().setOpen(true);
}
