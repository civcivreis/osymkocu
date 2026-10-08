export const adminColors = {
  bg: '#F6F1E8',
  surface: '#FFFCF7',
  navy: '#0F1C2E',
  accent: '#C45C26',
  accentSoft: '#F3E0D4',
  border: '#E4DDD0',
  muted: '#475569',
} as const;

export const adminCard = {
  backgroundColor: '#FFFCF7',
  borderRadius: 16,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  padding: 16,
  gap: 10,
} as const;

export const adminField = {
  minHeight: 44,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  borderRadius: 12,
  paddingHorizontal: 12,
  paddingVertical: 10,
  backgroundColor: '#fff',
} as const;

export const adminBtn = {
  minHeight: 44,
  paddingHorizontal: 16,
  borderRadius: 12,
  backgroundColor: '#C45C26',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
};

export const adminGhost = {
  minHeight: 40,
  paddingHorizontal: 14,
  borderRadius: 12,
  borderWidth: 1,
  borderColor: '#E4DDD0',
  alignItems: 'center' as const,
  justifyContent: 'center' as const,
  backgroundColor: '#fff',
};

export const adminChip = {
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
  backgroundColor: '#EDE6D8',
} as const;

export const adminChipOn = {
  backgroundColor: '#F3E0D4',
} as const;
