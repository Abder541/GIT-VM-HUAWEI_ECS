import {
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
  useEffect,
} from 'react';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost';
const variants: Record<Variant, string> = {
  primary: 'bg-primary text-primary-foreground hover:opacity-90 active:opacity-100',
  secondary: 'border border-border bg-card hover:bg-muted text-foreground',
  danger: 'bg-red-600 text-white hover:bg-red-500',
  ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
};

export function Button({
  variant = 'primary',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      className={`inline-flex h-9 select-none items-center justify-center gap-2 rounded-lg px-3.5 text-sm font-medium transition-all duration-150 disabled:pointer-events-none disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 ${variants[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`rounded-xl border border-border bg-card ${className}`}>{children}</div>;
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const ctrl =
  'w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/15';

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${ctrl} h-9 ${props.className ?? ''}`} />;
}
export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${ctrl} h-9 ${props.className ?? ''}`} />;
}
export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={`${ctrl} resize-y py-2 leading-relaxed ${props.className ?? ''}`} />;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-muted ${className}`} />;
}

export function TableSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="space-y-px">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <Skeleton className="h-4 w-10" />
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-4 flex-1" />
            <Skeleton className="h-5 w-20 rounded-full" />
            <Skeleton className="h-7 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} width="16" height="16" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3.5" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
    </svg>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-[2px]" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border bg-elevated p-6 shadow-2xl shadow-black/20">
        <h3 className="text-base font-semibold tracking-tight">{title}</h3>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        {children && <div className="mt-4 text-sm">{children}</div>}
        {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}

/* ---- brand ---- */
export function Logo({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <span className={`grid place-items-center rounded-lg bg-primary text-primary-foreground ${className}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="4.5" y="4.5" width="11" height="11" rx="2.5" stroke="currentColor" strokeWidth="2" />
        <rect x="9.5" y="9.5" width="11" height="11" rx="2.5" fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="2" />
      </svg>
    </span>
  );
}

export function MicrosoftLogo({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

/* ---- icons (1.75 stroke for a finer, pro look) ---- */
type IconProps = { className?: string };
const I = (p: { d: string } & IconProps) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
    <path d={p.d} />
  </svg>
);
export const IconSun = (p: IconProps) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
    <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
);
export const IconMoon = (p: IconProps) => <I {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />;
export const IconPlus = (p: IconProps) => <I {...p} d="M12 5v14M5 12h14" />;
export const IconServer = (p: IconProps) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
    <rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" />
  </svg>
);
export const IconDownload = (p: IconProps) => <I {...p} d="M12 3v12m0 0 4-4m-4 4-4-4M4 21h16" />;
export const IconTrash = (p: IconProps) => <I {...p} d="M3 6h18M8 6V4h8v2m-9 0 1 14h8l1-14" />;
export const IconCheck = (p: IconProps) => <I {...p} d="M20 6 9 17l-5-5" />;
export const IconX = (p: IconProps) => <I {...p} d="M18 6 6 18M6 6l12 12" />;
export const IconBack = (p: IconProps) => <I {...p} d="M19 12H5m7-7-7 7 7 7" />;
export const IconLogout = (p: IconProps) => <I {...p} d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9" />;
export const IconCopy = (p: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
    <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </svg>
);
export const IconPlay = (p: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 24 24" className={p.className}><path d="M7 5v14l11-7z" fill="currentColor" /></svg>
);
export const IconStop = (p: IconProps) => (
  <svg width="16" height="16" viewBox="0 0 24 24" className={p.className}><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" /></svg>
);
export const IconReboot = (p: IconProps) => <I {...p} d="M21 12a9 9 0 1 1-2.64-6.36M21 4v5h-5" />;
export const IconMonitor = (p: IconProps) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={p.className}>
    <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
  </svg>
);
