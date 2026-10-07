export type AppRole = 'user' | 'moderator' | 'admin' | 'super_admin';

export function isStaffRole(role?: string | null): role is AppRole {
  return role === 'moderator' || role === 'admin' || role === 'super_admin';
}

export function canModerate(role?: string | null) {
  return isStaffRole(role);
}

export function canManageUsers(role?: string | null) {
  return role === 'admin' || role === 'super_admin';
}

export function canManageExams(role?: string | null) {
  return role === 'admin' || role === 'super_admin';
}

export function isSuperAdmin(role?: string | null) {
  return role === 'super_admin';
}

export function mapAdminError(message: string) {
  const raw = message.toLowerCase();
  if (raw.includes('schema cache') || raw.includes('could not find the function') || raw.includes('pgrst202')) {
    return 'Sunucu şeması eksik. 0038 SQL’ini Supabase SQL Editor’da çalıştır.';
  }
  if (raw.includes('column') && (raw.includes('does not exist') || raw.includes('undefined'))) {
    return 'Veritabanı sütunu eksik. 0036–0038 migration’larını kontrol et.';
  }
  if (raw.includes('admin_only')) return 'Bu işlem için admin yetkisi gerekir.';
  if (raw.includes('super_admin_only')) return 'Bu işlem yalnızca süper admin.';
  if (raw.includes('staff_only') || raw.includes('moderator_only')) return 'Bu panele yetkin yok.';
  if (raw.includes('last_super_admin')) return 'Son süper admin kaldırılamaz.';
  if (raw.includes('self_demote')) return 'Kendi süper admin rolünü kaldıramazsın.';
  if (raw.includes('exam_hour')) return 'Yayın saati Europe/Istanbul 20:00–22:00 slotlarında olmalı.';
  if (raw.includes('exam_locked')) return 'Bu sınava katılım başladı; soru seti kilitli.';
  if (raw.includes('unauthorized')) return 'Oturum gerekli.';
  return message;
}
