export type ModerationLevel = 'ok' | 'warn' | 'block';

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
};

const BLOCK_PHRASES = [
  'ananisik',
  'bacinisik',
  'annenisik',
  'kizinisik',
  'karinisik',
  'aminakoy',
  'aminasik',
  'orospuoc',
  'gotunusik',
  'gotunesik',
  'anasinisik',
  'sikeyim',
  'sikerim',
  'oldureceg',
  'oldururum',
  'killyourself',
];

const BLOCK_TOKENS = [
  'orospu',
  'orospuocugu',
  'yarrak',
  'yarak',
  'sikeyim',
  'sikerim',
  'pezevenk',
  'gavat',
  'ibne',
  'kys',
];

const WARN_TOKENS = ['amk', 'amq', 'siktir'];

export function normalizeModerationText(raw: string) {
  const lowered = raw
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[013457@$]/g, (ch) => LEET[ch] ?? ch)
    .replace(/(.)\1{1,}/g, '$1');
  const spaced = ` ${lowered.replace(/[^a-z0-9]+/g, ' ').trim()} `;
  const compact = spaced.replace(/ /g, '');
  return { spaced, compact };
}

export function moderateContent(body: string): ModerationLevel {
  const { spaced, compact } = normalizeModerationText(body);
  if (BLOCK_PHRASES.some((phrase) => compact.includes(phrase))) return 'block';
  if (BLOCK_TOKENS.some((token) => spaced.includes(` ${token} `))) return 'block';
  if (WARN_TOKENS.some((token) => spaced.includes(` ${token} `))) return 'warn';
  return 'ok';
}

export function isBlockedRoomMessage(body: string) {
  return moderateContent(body) === 'block';
}
