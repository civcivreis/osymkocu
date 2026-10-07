export const landing = {
  cream: '#F6F1E8',
  creamDeep: '#EDE6D8',
  paper: '#FFFcf7',
  navy: '#0F1C2E',
  navyMid: '#1C2E4A',
  ink: '#0F1C2E',
  body: '#334155',
  muted: '#475569',
  line: '#E4DDD0',
  orange: '#C45C26',
  orangeSoft: '#F4E2D6',
  white: '#FFFFFF',
  success: '#176C44',
  max: 1200,
} as const;

export function landingPad(width: number) {
  if (width < 768) return 18;
  if (width < 1024) return 24;
  return 32;
}

export function landingSectionY(width: number) {
  if (width < 768) return 56;
  if (width < 1024) return 72;
  return 96;
}
