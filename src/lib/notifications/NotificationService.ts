export type NotificationPayload = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export const NotificationService = {
  async registerPushToken(): Promise<string | null> {
    return null;
  },
  async scheduleLocal(_payload: NotificationPayload, _when: Date): Promise<void> {
    return;
  },
  async cancelAll(): Promise<void> {
    return;
  },
};
