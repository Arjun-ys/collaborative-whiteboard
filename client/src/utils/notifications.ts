import { createId } from './id';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
  duration?: number;
}
export interface Confirmation { message: string; resolve: (result: boolean) => void }
const listeners = new Set<(toast: Toast) => void>();
const confirmations = new Set<(confirmation: Confirmation) => void>();
let pending: Confirmation | null = null;
let promise: Promise<boolean> | null = null;
const emit = (type: Toast['type'], message: string, duration: number) =>
  listeners.forEach((listener) => listener({ id: createId(), type, message, duration }));

export const toast = {
  success: (message: string, duration = 2500) => emit('success', message, duration),
  info: (message: string, duration = 2500) => emit('info', message, duration),
  warning: (message: string, duration = 3500) => emit('warning', message, duration),
  error: (message: string, duration = 4000) => emit('error', message, duration),
};

export const subscribeToToasts = (listener: (toast: Toast) => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};

export const subscribeToConfirmations = (listener: (confirmation: Confirmation) => void) => {
  confirmations.add(listener);
  if (pending) listener(pending);
  return () => {
    confirmations.delete(listener);
    if (!confirmations.size) pending?.resolve(false);
  };
};

export const confirmDialog = (message: string): Promise<boolean> => {
  if (promise) return promise;
  if (!confirmations.size) return Promise.resolve(false);
  promise = new Promise((resolve) => {
    pending = { message, resolve: (result) => {
      pending = null;
      promise = null;
      resolve(result);
    } };
    confirmations.forEach((listener) => listener(pending!));
  });
  return promise;
};
