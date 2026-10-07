const AVATAR_COLORS = ['#1B2B44', '#C45C26', '#1F7A4D', '#B45309', '#3A5A80', '#8B3A2F', '#2F5D50', '#6B4C7A'];

export function taggedName(name?: string | null, tag?: number | null) {
  const label = (name ?? '').trim() || 'Öğrenci';
  if (!tag || tag < 1000) return label;
  return `${label}#${tag}`;
}

export function avatarColor(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export function avatarLetter(name?: string | null) {
  return ((name ?? 'Ö').trim().slice(0, 1) || 'Ö').toUpperCase();
}

export function postedAt(iso?: string | null) {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60000));
  if (mins < 1) return 'şimdi';
  if (mins < 60) return `${mins} dk`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} sa`;
  return `${Math.round(hours / 24)} g`;
}

export function clockLabel(iso?: string | null) {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();
  if (sameDay) {
    return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }
  return postedAt(iso);
}

export function groupActivityLine(memberCount: number, lastAt?: string | null) {
  const members = `${memberCount} üye`;
  if (!lastAt) return members;
  const mins = Math.max(0, Math.round((Date.now() - Date.parse(lastAt)) / 60000));
  if (!Number.isFinite(mins)) return members;
  if (mins <= 8) return `${members} • az önce aktif`;
  if (mins < 24 * 60) return `${members} • bugün aktif`;
  return members;
}

export function subjectGlyph(name: string) {
  const n = name.toLocaleLowerCase('tr-TR');
  if (n.includes('coğrafya') || n.includes('cografya')) return '🌍';
  if (n.includes('tarih')) return '🏛';
  if (n.includes('matematik')) return '➗';
  if (n.includes('geometri')) return '△';
  if (n.includes('fizik')) return '⚡';
  if (n.includes('kimya')) return '🧪';
  if (n.includes('biyoloji')) return '🌿';
  if (n.includes('türkçe') || n.includes('turkce') || n.includes('edebiyat')) return '📖';
  return '📚';
}
