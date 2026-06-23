import { useEffect, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';
import type { User } from '../types';
import { IconLogout, Logo } from '../ui';
import { LangToggle, ThemeToggle } from './Toggles';
import { NotificationBell } from './NotificationBell';

function navCls({ isActive }: { isActive: boolean }) {
  return `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
    isActive ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
  }`;
}

function initials(email: string) {
  const name = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function logout() {
    await api.logout();
    qc.clear();
    navigate('/');
    location.reload();
  }

  // Keyboard shortcuts: n=new, h=home, p=profile, a=admin. Ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return;
      if (e.key === 'n') { e.preventDefault(); navigate('/new'); }
      else if (e.key === 'h') navigate('/');
      else if (e.key === 'p') navigate('/profile');
      else if (e.key === 'a' && user.role === 'admin') navigate('/admin');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, user.role]);

  return (
    <div className="min-h-full">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:border focus:border-border focus:bg-card focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        {t('common.skipToContent')}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-background/75 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-5">
          <NavLink to="/" className="flex items-center gap-2.5">
            <Logo className="h-8 w-8" />
            <span className="hidden leading-none sm:block">
              <span className="block text-sm font-semibold tracking-tight">VM Portal</span>
              <span className="block text-[11px] text-muted-foreground">GIT Cloud</span>
            </span>
          </NavLink>

          <div className="mx-1 hidden h-5 w-px bg-border sm:block" />

          <nav className="flex items-center gap-1">
            <NavLink to="/" end className={navCls}>
              {t('nav.dashboard')}
            </NavLink>
            <NavLink to="/new" className={navCls}>
              {t('nav.create')}
            </NavLink>
            {(user.role === 'formateur' || user.role === 'admin') && (
              <NavLink to="/trainer" className={navCls}>
                {t('nav.trainer')}
              </NavLink>
            )}
            {user.role === 'admin' && (
              <NavLink to="/admin" className={navCls}>
                {t('nav.admin')}
              </NavLink>
            )}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <NotificationBell />
            <LangToggle />
            <ThemeToggle />
            <div className="mx-1 hidden h-5 w-px bg-border md:block" />
            <NavLink
              to="/profile"
              title={t('profile.title')}
              className="hidden h-8 w-8 place-items-center rounded-full border border-border bg-muted text-xs font-semibold text-muted-foreground transition hover:text-foreground md:grid"
            >
              {initials(user.email)}
            </NavLink>
            <button
              onClick={logout}
              aria-label={t('nav.logout')}
              title={t('nav.logout')}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              <IconLogout className="h-[18px] w-[18px]" />
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-6xl px-5 py-10">{children}</main>
    </div>
  );
}
