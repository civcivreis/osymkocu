const NUDGE = [
  'Okuyup anladıysan Anladım butonuna basmayı unutma.',
  'Anlamadığın yeri bana sorabilirsin.',
];

function pick(list: string[], salt: number) {
  return list[Math.abs(salt) % list.length];
}

export function motivationOnOpen(_salt: number) {
  return 'Hazırsan hap bilgiye bak, sonra kısa soruyu çözelim.';
}

export function motivationOnProgress(percent: number, _salt: number) {
  if (percent >= 80) return 'Son bir bölüm kaldı.';
  if (percent >= 50) return 'Yarısını geçtin. Devam.';
  return `Harika ilerliyorsun 🎯 Konunun %${percent}'si tamam.`;
}

export function motivationOnCorrect(_salt: number) {
  return 'Harika, doğru bildin ✓';
}

export function motivationOnWrong(_salt: number) {
  return 'Canını sıkma, küçük bir noktayı kaçırdın. Detaylı anlatıma bakıp tekrar deneyebilirsin.';
}

export function motivationReadNudge(salt: number) {
  return pick(NUDGE, salt);
}

export function autoNextCopy() {
  return 'Bu konuyu tamamladın.';
}

export function packageProgressCopy(position: number, total: number) {
  return `${total} konudan ${position}'ü tamam. Devam.`;
}

export function looksLikeQuestion(text: string) {
  const t = text.trim();
  if (t.length < 8) return false;
  if (/[?？]/.test(t)) return true;
  return /neden|nasıl|ne demek|anlamadım|açıkla|farkı ne/i.test(t);
}
