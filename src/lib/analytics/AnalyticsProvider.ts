export const analyticsEvents = [
  'signup_completed',
  'onboarding_completed',
  'exam_selected',
  'study_task_completed',
  'question_answered',
  'wrong_question_saved',
  'wrong_question_mastered',
  'lesson_started',
  'test_started',
  'coach_opened',
  'ai_question_sent',
  'image_question_sent',
  'camp_joined',
  'streak_completed',
  'practice_test_added',
  'paywall_viewed',
  'subscription_started',
  'match_suggestion_shown',
  'match_suggestion_accepted',
  'match_suggestion_declined',
  'match_suggestion_ignored',
  'match_suggestion_expired',
] as const;

export type AnalyticsEvent = (typeof analyticsEvents)[number];

export type AnalyticsClient = {
  identify: (userId: string, traits?: Record<string, unknown>) => void;
  reset: () => void;
  track: (event: AnalyticsEvent, properties?: Record<string, unknown>) => void;
};

class ConsoleAnalytics implements AnalyticsClient {
  identify(userId: string, traits?: Record<string, unknown>) {
    if (__DEV__) {
      console.log('[analytics] identify', userId, traits ?? {});
    }
  }

  reset() {
    if (__DEV__) {
      console.log('[analytics] reset');
    }
  }

  track(event: AnalyticsEvent, properties?: Record<string, unknown>) {
    if (__DEV__) {
      console.log('[analytics] track', event, properties ?? {});
    }
  }
}

let client: AnalyticsClient = new ConsoleAnalytics();

export const AnalyticsProvider = {
  setClient(next: AnalyticsClient) {
    client = next;
  },
  identify(userId: string, traits?: Record<string, unknown>) {
    client.identify(userId, traits);
  },
  reset() {
    client.reset();
  },
  track(event: AnalyticsEvent, properties?: Record<string, unknown>) {
    client.track(event, properties);
  },
};
