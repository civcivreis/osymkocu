import type { SubscriptionPlan } from '@/src/lib/supabase/types';

export const featureKeys = [
  'canUseImageSolver',
  'canGenerateUnlimitedQuestions',
  'canAccessAdvancedAnalytics',
  'canAccessPersonalTests',
  'canJoinPremiumCamps',
] as const;

export type FeatureKey = (typeof featureKeys)[number];

const PRO_FEATURES: Record<FeatureKey, boolean> = {
  canUseImageSolver: true,
  canGenerateUnlimitedQuestions: true,
  canAccessAdvancedAnalytics: true,
  canAccessPersonalTests: true,
  canJoinPremiumCamps: true,
};

const FREE_FEATURES: Record<FeatureKey, boolean> = {
  canUseImageSolver: false,
  canGenerateUnlimitedQuestions: false,
  canAccessAdvancedAnalytics: false,
  canAccessPersonalTests: false,
  canJoinPremiumCamps: false,
};

export function hasFeature(plan: SubscriptionPlan, feature: FeatureKey): boolean {
  if (plan === 'pro') return PRO_FEATURES[feature];
  return FREE_FEATURES[feature];
}

export function getDailyAiLimit(_plan: SubscriptionPlan): number {
  return Number.POSITIVE_INFINITY;
}

export function featureGate(plan: SubscriptionPlan, feature: FeatureKey): void {
  if (!hasFeature(plan, feature)) {
    throw new Error(`PREMIUM_REQUIRED:${feature}`);
  }
}
