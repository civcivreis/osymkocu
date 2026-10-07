import { type ReactNode } from 'react';

import type { PendingChatImage } from '@/src/features/social/ChatComposer';

export function ChatDropZone({ children }: { children: ReactNode; onImage?: (image: PendingChatImage) => void }) {
  return <>{children}</>;
}
