import { getSupabase } from '@/src/lib/supabase/client';

export type XpBoardRow = {
  rank: number;
  user_id: string;
  display_name: string;
  display_tag?: number | null;
  avatar_url?: string | null;
  total_xp: number;
  weekly_xp?: number;
  level: number;
  exam_name?: string | null;
};

export type XpSummary = {
  user_id: string;
  total_xp: number;
  weekly_xp: number;
  level: number;
  global_rank: number | null;
  weekly_rank: number | null;
  humans?: number;
};

export async function fetchWeeklyXpLeaderboard(limit = 5, examId?: string | null) {
  const { data, error } = await getSupabase().rpc('get_weekly_xp_leaderboard', {
    p_limit: limit,
    p_exam_id: examId ?? null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as XpBoardRow[];
}

export async function fetchGlobalXpLeaderboard(limit = 20, examId?: string | null) {
  const { data, error } = await getSupabase().rpc('get_global_xp_leaderboard', {
    p_limit: limit,
    p_exam_id: examId ?? null,
  });
  if (error) throw error;
  return (Array.isArray(data) ? data : []) as XpBoardRow[];
}

export async function fetchUserXpSummary(userId?: string | null) {
  const { data, error } = await getSupabase().rpc('get_user_xp_summary', { p_user: userId ?? null });
  if (error) throw error;
  return data as XpSummary;
}
