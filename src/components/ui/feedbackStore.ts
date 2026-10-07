import { create } from 'zustand';

export type FeedbackTone = 'info' | 'error' | 'success';

export type ConfirmRequest = {
  title: string;
  subtitle?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
};

type FeedbackState = {
  toast: { message: string; tone: FeedbackTone } | null;
  confirm: ConfirmRequest | null;
  showToast: (message: string, tone?: FeedbackTone) => void;
  clearToast: () => void;
  askConfirm: (input: ConfirmRequest) => void;
  clearConfirm: () => void;
};

export const useFeedbackStore = create<FeedbackState>((set) => ({
  toast: null,
  confirm: null,
  showToast: (message, tone = 'info') => set({ toast: { message, tone } }),
  clearToast: () => set({ toast: null }),
  askConfirm: (confirm) => set({ confirm }),
  clearConfirm: () => set({ confirm: null }),
}));

export function toastError(error: unknown, fallback = 'Hata') {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;
  useFeedbackStore.getState().showToast(message || fallback, 'error');
}

export function toastInfo(message: string) {
  useFeedbackStore.getState().showToast(message, 'info');
}

export function toastSuccess(message: string) {
  useFeedbackStore.getState().showToast(message, 'success');
}

export function askConfirm(input: ConfirmRequest) {
  useFeedbackStore.getState().askConfirm(input);
}
