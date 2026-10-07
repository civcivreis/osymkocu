export function greetingForHour(hour: number, name: string): string {
  const safeName = firstName(name);
  if (hour >= 5 && hour < 12) return `Günaydın, ${safeName} 👋`;
  if (hour >= 12 && hour < 18) return `İyi günler, ${safeName} 👋`;
  if (hour >= 18 && hour < 22) return `İyi akşamlar, ${safeName} 👋`;
  return `İyi geceler, ${safeName} 👋`;
}

export function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || 'öğrenci';
}

export function daysUntil(dateIso: string | null | undefined, now = new Date()): number | null {
  if (!dateIso) return null;
  const target = new Date(`${dateIso}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = Math.ceil((target.getTime() - start.getTime()) / 86_400_000);
  return diff;
}
