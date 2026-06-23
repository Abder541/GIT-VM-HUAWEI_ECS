import type { OsFamily } from '../types';

// Tasteful abstract marks (not exact brand logos): a coloured tile + a glyph.
// Linux families share a terminal glyph, Windows gets window panes.
const FAM: Record<OsFamily, { bg: string; glyph: 'terminal' | 'windows' }> = {
  ubuntu: { bg: '#E95420', glyph: 'terminal' },
  debian: { bg: '#A81D33', glyph: 'terminal' },
  amazon: { bg: '#EC7211', glyph: 'terminal' },
  rocky: { bg: '#10B981', glyph: 'terminal' },
  alma: { bg: '#1F557F', glyph: 'terminal' },
  windows: { bg: '#0078D4', glyph: 'windows' },
};

function Terminal() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m7 9 3 3-3 3M13 15h4" />
    </svg>
  );
}
function Windows() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 5.5 11 4.3v7.2H3zM13 4 21 3v8.5h-8zM3 12.5h8v7.2L3 18.5zM13 12.5h8V21l-8-1.2z" />
    </svg>
  );
}

export function OsIcon({ family, className = 'h-9 w-9' }: { family: OsFamily; className?: string }) {
  const f = FAM[family] ?? FAM.ubuntu;
  return (
    <span className={`grid shrink-0 place-items-center rounded-lg text-white ${className}`} style={{ backgroundColor: f.bg }}>
      {f.glyph === 'windows' ? <Windows /> : <Terminal />}
    </span>
  );
}
