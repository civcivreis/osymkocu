import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { retainChannel } from '@/src/lib/realtime/retainChannel';
import { useAuthStore } from '@/src/stores/authStore';

export function useNotificationRealtime() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const client = useQueryClient();

  useEffect(() => {
    if (!userId) return;
    return retainChannel(`notifications:${userId}`, (channel) =>
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
        () => {
          void client.invalidateQueries({ queryKey: ['notifications', userId] });
        },
      ),
    );
  }, [client, userId]);
}
