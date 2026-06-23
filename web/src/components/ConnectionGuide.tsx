import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { Button, IconCopy, IconDownload, Spinner } from '../ui';

type Connect = 'ssh' | 'rdp';

function downloadText(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Copyable({ value }: { value: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-1 pl-3">
      <code className="flex-1 overflow-x-auto whitespace-nowrap py-1.5 font-mono text-xs text-foreground">{value}</code>
      <button
        onClick={() => {
          navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
      >
        <IconCopy className="h-3.5 w-3.5" />
        {copied ? t('common.copied') : t('common.copy')}
      </button>
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? 'font-mono text-xs' : 'font-medium'}>{value}</span>
    </div>
  );
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2.5">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-sm">
          <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
            {i + 1}
          </span>
          <span className="leading-relaxed text-foreground/90">{it}</span>
        </li>
      ))}
    </ol>
  );
}

function Tabs({ tabs, active, onSelect }: { tabs: { id: string; label: string }[]; active: string; onSelect: (id: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1">
      {tabs.map((tb) => (
        <button
          key={tb.id}
          onClick={() => onSelect(tb.id)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            active === tb.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {tb.label}
        </button>
      ))}
    </div>
  );
}

function PasswordReveal({ id }: { id: number }) {
  const { t } = useTranslation();
  const [pw, setPw] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const reveal = async () => {
    if (pw) return setPw(null);
    setLoading(true);
    try {
      const r = await api.password(id);
      setPw(r.password);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-1 pl-3">
      <code className="flex-1 overflow-x-auto whitespace-nowrap py-1.5 font-mono text-xs">{pw ?? '••••••••••••'}</code>
      {pw && (
        <button
          onClick={() => {
            navigator.clipboard.writeText(pw);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground"
        >
          <IconCopy className="h-3.5 w-3.5" />
          {copied ? t('common.copied') : t('common.copy')}
        </button>
      )}
      <button
        onClick={reveal}
        disabled={loading}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition hover:text-foreground disabled:opacity-50"
      >
        {loading ? <Spinner className="h-3.5 w-3.5" /> : null}
        {pw ? t('guide.hide') : t('guide.reveal')}
      </button>
    </div>
  );
}

export function ConnectionGuide({
  id,
  ip,
  user,
  keyName,
  connect,
}: {
  id: number;
  ip: string;
  user: string;
  keyName: string;
  connect: Connect;
}) {
  const { t } = useTranslation();
  const keyFile = `${keyName}.pem`;
  const sshCmd = `ssh -i ${keyFile} ${user}@${ip}`;

  const [tab, setTab] = useState<string>(connect === 'rdp' ? 'moba' : 'moba');

  if (connect === 'rdp') {
    return (
      <div className="space-y-4">
        <div className="divide-y divide-border rounded-lg border border-border bg-muted/30 px-3">
          <Info label={t('guide.host')} value={ip} mono />
          <Info label={t('guide.user')} value={user} mono />
        </div>
        <div>
          <p className="mb-1.5 text-xs font-medium text-muted-foreground">{t('guide.password')}</p>
          <PasswordReveal id={id} />
          <p className="mt-1.5 text-xs text-muted-foreground">{t('guide.pwHint')}</p>
        </div>

        <Button
          variant="secondary"
          onClick={() =>
            downloadText(
              `gitvm-${id}.rdp`,
              `full address:s:${ip}:3389\nusername:s:${user}\nscreen mode id:i:2\nprompt for credentials:i:1\n`,
              'application/x-rdp'
            )
          }
        >
          <IconDownload className="h-4 w-4" /> {t('guide.dlRdp')}
        </Button>

        <Tabs
          active={tab}
          onSelect={setTab}
          tabs={[
            { id: 'moba', label: t('guide.tabMoba') },
            { id: 'mstsc', label: t('guide.tabMstsc') },
            { id: 'termius', label: t('guide.tabTermius') },
          ]}
        />
        {tab === 'moba' && (
          <Steps
            items={[t('guide.mobaRdp1'), t('guide.mobaRdp2', { user }), t('guide.mobaRdp3')]}
          />
        )}
        {tab === 'mstsc' && (
          <Steps items={[t('guide.mstsc1'), t('guide.mstsc2', { host: ip, user }), t('guide.mstsc3')]} />
        )}
        {tab === 'termius' && <p className="text-sm text-muted-foreground">{t('guide.termiusNoRdp')}</p>}

        <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          {t('guide.port3389')}
        </p>
      </div>
    );
  }

  // SSH (Linux)
  return (
    <div className="space-y-4">
      <div className="divide-y divide-border rounded-lg border border-border bg-muted/30 px-3">
        <Info label={t('guide.host')} value={ip} mono />
        <Info label={t('guide.user')} value={user} mono />
        <Info label={t('guide.keyName')} value={keyFile} mono />
      </div>

      <a href={api.keyUrl(id)} className="inline-flex">
        <Button variant="secondary">
          <IconDownload className="h-4 w-4" /> {t('access.downloadKey')}
        </Button>
      </a>

      <Tabs
        active={tab}
        onSelect={setTab}
        tabs={[
          { id: 'moba', label: t('guide.tabMoba') },
          { id: 'termius', label: t('guide.tabTermius') },
          { id: 'cli', label: t('guide.tabCli') },
        ]}
      />

      {tab === 'moba' && (
        <Steps
          items={[
            t('guide.mobaSsh1'),
            t('guide.mobaSsh2', { user }),
            t('guide.mobaSsh3', { key: keyFile }),
            t('guide.mobaSsh4'),
          ]}
        />
      )}
      {tab === 'termius' && (
        <Steps
          items={[
            t('guide.termius1', { key: keyFile }),
            t('guide.termius2', { host: ip, user }),
            t('guide.termius3'),
            t('guide.termius4'),
          ]}
        />
      )}
      {tab === 'cli' && (
        <div className="space-y-3">
          <Steps items={[t('guide.cli1'), t('guide.cli2'), t('guide.cli3')]} />
          <Copyable value={`chmod 600 ${keyFile}`} />
          <Copyable value={sshCmd} />
        </div>
      )}
    </div>
  );
}
