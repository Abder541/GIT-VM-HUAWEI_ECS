import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  type: ToastType;
  message: string;
}
interface ToastApi {
  success: (m: string) => void;
  error: (m: string) => void;
  info: (m: string) => void;
}

const Ctx = createContext<ToastApi | null>(null);

const styles: Record<ToastType, string> = {
  success: 'border-emerald-500/30 text-emerald-700 dark:text-emerald-400',
  error: 'border-red-500/30 text-red-700 dark:text-red-400',
  info: 'border-border text-foreground',
};
const dot: Record<ToastType, string> = {
  success: 'bg-emerald-500',
  error: 'bg-red-500',
  info: 'bg-blue-500',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(0);

  const push = useCallback((type: ToastType, message: string) => {
    const id = ++idRef.current;
    setToasts((t) => [...t, { id, type, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);

  const api: ToastApi = {
    success: (m) => push('success', m),
    error: (m) => push('error', m),
    info: (m) => push('info', m),
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
            className={`pointer-events-auto flex cursor-pointer items-center gap-2.5 rounded-lg border bg-elevated px-3.5 py-2.5 text-sm font-medium shadow-lg shadow-black/10 ${styles[t.type]}`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[t.type]}`} />
            <span className="text-foreground">{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast(): ToastApi {
  const c = useContext(Ctx);
  if (!c) throw new Error('useToast outside provider');
  return c;
}
