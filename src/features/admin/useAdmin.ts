import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { mapAdminError, isStaffRole, canManageExams, canManageUsers } from '@/src/features/admin/roles';
import { mapExamError } from '@/src/features/system-exams/useSystemExams';
import { getSupabase } from '@/src/lib/supabase/client';
import { useAuthStore } from '@/src/stores/authStore';

function asList<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [];
}

export function useStaffContext() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: ['staff-context', session?.user.id],
    enabled: Boolean(session),
    retry: false,
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('get_staff_context');
      if (error) throw new Error(mapAdminError(error.message));
      return data as { role: 'moderator' | 'admin' | 'super_admin'; ok: boolean };
    },
  });
}

export function useAdminStats() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-stats'],
    enabled: isStaffRole(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_dashboard_stats');
      if (error) throw new Error(mapAdminError(error.message));
      return data as Record<string, unknown>;
    },
  });
}

export function useAdminExams() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-exams'],
    enabled: canManageExams(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_list_exams');
      if (error) throw new Error(mapAdminError(error.message));
      return asList<Record<string, unknown>>(data);
    },
  });
}

export function useAdminUpsertExam() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const { data, error } = await getSupabase().rpc('admin_upsert_system_exam', { p_payload: payload });
      if (error) throw new Error(mapAdminError(mapExamError(error.message)));
      return data as { id: string };
    },
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin-exams'] }),
  });
}

export function useAdminUsers(search: string) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-users', search],
    enabled: canManageUsers(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_list_users', { p_search: search, p_limit: 50 });
      if (error) throw new Error(mapAdminError(error.message));
      return asList<Record<string, unknown>>(data);
    },
  });
}

export function useAdminReports(status: string, contentType: string, reason: string) {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-reports', status, contentType, reason],
    enabled: isStaffRole(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_list_reports', {
        p_status: status,
        p_content_type: contentType || null,
        p_reason: reason || null,
      });
      if (error) throw new Error(mapAdminError(error.message));
      return asList<Record<string, unknown>>(data);
    },
  });
}

export function useAdminCatalog() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-catalog'],
    enabled: canManageExams(role),
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_catalog');
      if (error) throw new Error(mapAdminError(error.message));
      return data as {
        exams: { id: string; slug: string; name: string }[];
        subjects: { id: string; exam_id: string; slug: string; name: string }[];
        topics: { id: string; subject_id: string; slug: string; name: string }[];
      };
    },
  });
}

export function useAdminStaff() {
  const role = useAuthStore((s) => s.profile?.app_role);
  return useQuery({
    queryKey: ['admin-staff'],
    enabled: role === 'super_admin',
    queryFn: async () => {
      const { data, error } = await getSupabase().rpc('admin_list_staff');
      if (error) throw new Error(mapAdminError(error.message));
      return asList<Record<string, unknown>>(data);
    },
  });
}
