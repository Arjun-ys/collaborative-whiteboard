import React, { useEffect, useState, useCallback } from 'react';
import { createId } from '../utils/id';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'info' | 'warning' | 'error';
  duration?: number;
}

// Global toast emitter — components can call `toast.success(...)` without prop drilling
type ToastListener = (t: Toast) => void;
const listeners: Set<ToastListener> = new Set();

const emit = (t: Toast) => listeners.forEach((fn) => fn(t));

export const toast = {
  success: (message: string, duration = 2500) =>
    emit({ id: createId(), message, type: 'success', duration }),
  info: (message: string, duration = 2500) =>
    emit({ id: createId(), message, type: 'info', duration }),
  warning: (message: string, duration = 3500) =>
    emit({ id: createId(), message, type: 'warning', duration }),
  error: (message: string, duration = 4000) =>
    emit({ id: createId(), message, type: 'error', duration }),
};

// ── Confirm dialog state ──────────────────────────────────────────────
type ConfirmResolver = (result: boolean) => void;
let confirmState: {
  message: string;
  resolve: ConfirmResolver;
} | null = null;
const confirmListeners: Set<() => void> = new Set();

export const confirmDialog = (message: string): Promise<boolean> => {
  return new Promise((resolve) => {
    confirmState = { message, resolve };
    confirmListeners.forEach((fn) => fn());
  });
};

// ── Visual Components ─────────────────────────────────────────────────

const typeStyles: Record<Toast['type'], { bg: string; icon: string }> = {
  success: {
    bg: 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300',
    icon: '✓',
  },
  info: {
    bg: 'bg-sky-500/15 border-sky-500/30 text-sky-300',
    icon: 'ℹ',
  },
  warning: {
    bg: 'bg-amber-500/15 border-amber-500/30 text-amber-300',
    icon: '⚠',
  },
  error: {
    bg: 'bg-red-500/15 border-red-500/30 text-red-300',
    icon: '✕',
  },
};

const ToastItem: React.FC<{ t: Toast; onDismiss: (id: string) => void }> = ({ t, onDismiss }) => {
  const [exiting, setExiting] = useState(false);
  const style = typeStyles[t.type];

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), (t.duration ?? 2500) - 300);
    const remove = setTimeout(() => onDismiss(t.id), t.duration ?? 2500);
    return () => { clearTimeout(timer); clearTimeout(remove); };
  }, [t, onDismiss]);

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border backdrop-blur-lg shadow-2xl text-sm font-medium transition-all duration-300 ${style.bg} ${
        exiting ? 'opacity-0 translate-y-2' : 'opacity-100 translate-y-0'
      }`}
    >
      <span className="text-base leading-none">{style.icon}</span>
      <span>{t.message}</span>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirm, setConfirm] = useState<{ message: string; resolve: ConfirmResolver } | null>(null);

  // Subscribe to toast events
  useEffect(() => {
    const handler: ToastListener = (t) => setToasts((prev) => [...prev, t]);
    listeners.add(handler);
    return () => { listeners.delete(handler); };
  }, []);

  // Subscribe to confirm events
  useEffect(() => {
    const handler = () => {
      if (confirmState) {
        setConfirm(confirmState);
        confirmState = null;
      }
    };
    confirmListeners.add(handler);
    return () => { confirmListeners.delete(handler); };
  }, []);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleConfirm = (result: boolean) => {
    confirm?.resolve(result);
    setConfirm(null);
  };

  return (
    <>
      {/* Toast stack */}
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[9999] flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem t={t} onDismiss={dismiss} />
          </div>
        ))}
      </div>

      {/* Confirm overlay */}
      {confirm && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200/50 dark:border-slate-800/50 shadow-2xl p-6 max-w-sm w-full mx-4 flex flex-col gap-5">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200 text-center leading-relaxed">
              {confirm.message}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => handleConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirm(true)}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-semibold bg-red-500 text-white hover:bg-red-600 transition-colors shadow-lg shadow-red-500/20"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
