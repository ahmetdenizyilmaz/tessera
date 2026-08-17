/**
 * Minimal app-wide toasts. The app had no way to tell the user anything
 * outside a dialog — refusals (panel limit, bad input) went to console.warn,
 * which reads as "the button is broken".
 *
 * notify('...') from anywhere; <Toasts/> renders them bottom-center.
 */
import { create } from 'zustand';

interface Toast {
  id: number;
  text: string;
}

interface ToastState {
  toasts: Toast[];
  push: (text: string) => void;
  remove: (id: number) => void;
}

let nextId = 1;
const TOAST_MS = 4500;

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (text: string) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, text }] }));
    setTimeout(() => {
      useToastStore.getState().remove(id);
    }, TOAST_MS);
  },
  remove: (id: number) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/** Fire-and-forget notification, callable from stores and plain modules. */
export function notify(text: string) {
  useToastStore.getState().push(text);
}

export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  if (toasts.length === 0) return null;
  return (
    <div
      style={{
        position: 'fixed',
        bottom: 40,
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        zIndex: 3000,
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => useToastStore.getState().remove(t.id)}
          style={{
            pointerEvents: 'auto',
            cursor: 'pointer',
            maxWidth: 420,
            padding: '8px 14px',
            borderRadius: 6,
            background: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            fontSize: 12.5,
            boxShadow: '0 6px 20px rgba(0,0,0,0.45)',
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
