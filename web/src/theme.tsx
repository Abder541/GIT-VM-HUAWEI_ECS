import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeCtx {
  mode: ThemeMode;
  resolved: 'light' | 'dark';
  cycle: () => void;
  setMode: (m: ThemeMode) => void;
}

const Ctx = createContext<ThemeCtx | null>(null);
const mq = () => window.matchMedia('(prefers-color-scheme: dark)');

function initialMode(): ThemeMode {
  const s = localStorage.getItem('theme');
  return s === 'light' || s === 'dark' || s === 'system' ? s : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(initialMode);
  const [sysDark, setSysDark] = useState(() => mq().matches);

  // Follow the OS theme live when in "system" mode.
  useEffect(() => {
    const m = mq();
    const h = () => setSysDark(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);

  const resolved: 'light' | 'dark' = mode === 'system' ? (sysDark ? 'dark' : 'light') : mode;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', resolved === 'dark');
    localStorage.setItem('theme', mode);
  }, [resolved, mode]);

  const cycle = () => setMode((m) => (m === 'system' ? 'light' : m === 'light' ? 'dark' : 'system'));

  return <Ctx.Provider value={{ mode, resolved, cycle, setMode }}>{children}</Ctx.Provider>;
}

export function useTheme(): ThemeCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useTheme outside provider');
  return c;
}
