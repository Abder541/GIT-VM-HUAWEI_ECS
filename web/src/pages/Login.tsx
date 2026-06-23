import { useTranslation } from 'react-i18next';
import { Button, IconCheck, Logo, MicrosoftLogo } from '../ui';
import { LangToggle, ThemeToggle } from '../components/Toggles';

export function Login() {
  const { t } = useTranslation();
  return (
    <div className="relative grid min-h-full place-items-center px-4">
      <div className="pointer-events-none absolute inset-0 bg-grid opacity-70" />

      <div className="absolute right-5 top-5 flex items-center gap-2">
        <LangToggle />
        <ThemeToggle />
      </div>

      <div className="relative w-full max-w-sm">
        <div className="rounded-2xl border border-border bg-card p-8 text-center shadow-xl shadow-black/5">
          <Logo className="mx-auto mb-5 h-12 w-12 rounded-xl" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">GIT Cloud</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">VM Portal</h1>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t('login.subtitle')}</p>

          <ul className="mx-auto mt-5 max-w-[16rem] space-y-2 text-left text-xs text-muted-foreground">
            {[t('login.feature1'), t('login.feature2'), t('login.feature3')].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <IconCheck className="h-4 w-4 shrink-0 text-emerald-500" />
                {f}
              </li>
            ))}
          </ul>

          <Button
            variant="secondary"
            className="mt-6 h-11 w-full"
            onClick={() => (window.location.href = '/auth/login')}
          >
            <MicrosoftLogo className="h-[18px] w-[18px]" />
            {t('login.button')}
          </Button>
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          {t('app.tagline')}
        </p>
      </div>
    </div>
  );
}
