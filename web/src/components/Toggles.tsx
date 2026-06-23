import { useTranslation } from 'react-i18next';
import { useTheme } from '../theme';
import { setLang } from '../i18n';
import { IconMonitor, IconMoon, IconSun } from '../ui';

export function ThemeToggle() {
  const { t } = useTranslation();
  const { mode, cycle } = useTheme();
  const Icon = mode === 'system' ? IconMonitor : mode === 'dark' ? IconMoon : IconSun;
  const label = `${t('theme.label')} : ${t(`theme.${mode}`)}`;
  return (
    <button
      onClick={cycle}
      aria-label={label}
      title={label}
      className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}

export function LangToggle() {
  const { i18n } = useTranslation();
  const cur = i18n.language?.startsWith('en') ? 'en' : 'fr';
  return (
    <div className="flex items-center rounded-lg border border-border bg-muted/50 p-0.5 text-xs font-semibold">
      {(['fr', 'en'] as const).map((l) => (
        <button
          key={l}
          onClick={() => setLang(l)}
          className={`rounded-md px-2 py-1 uppercase tracking-wide transition ${
            cur === l
              ? 'bg-card text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}
