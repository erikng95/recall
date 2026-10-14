import { create } from 'zustand';

interface ToastState {
  message?: string;
  show(msg: string): void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: undefined,
  show(message) {
    clearTimeout(timer);
    set({ message });
    timer = setTimeout(() => set({ message: undefined }), 2200);
  },
}));

export const toast = (msg: string) => useToast.getState().show(msg);
