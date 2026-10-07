/** Server `match_config()` ile aynı tutulmalı. UI bu dosyayı kullanır. */
export const MATCH_CONFIG = {
  cooldownHours: 2,
  maxSuggestionsPerDay: 3,
  rematchHours: 24,
  declineFatigueCount: 3,
  declineFatigueHours: 12,
  offerMinutes: 10,
  inAppBannerSeconds: 8,
  heartbeatStaleSeconds: 45,
} as const;
