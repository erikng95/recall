import type { CSSProperties, ReactNode } from 'react';
import type { MasteryLabel } from '@shared/knowledge.ts';

export function Ring({ pct, size = 64, children }: { pct: number; size?: number; children?: ReactNode }) {
  return (
    <div className="ring-wrap" style={{ width: size, height: size }}>
      <div className="ring" style={{ '--p': Math.max(0, Math.min(100, pct)), '--size': `${size}px` } as CSSProperties} />
      <div className="ring-label">{children ?? `${Math.round(pct)}%`}</div>
    </div>
  );
}

export function Meter({ pct, tone }: { pct: number; tone?: 'good' | 'warn' }) {
  return (
    <div
      className={`meter ${tone ?? ''}`}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
      style={{ '--p': Math.max(0, Math.min(100, pct)) } as CSSProperties}
    >
      <span />
    </div>
  );
}

export function masteryTone(label: MasteryLabel): string {
  switch (label) {
    case 'Mastered':
      return 'tone-good';
    case 'Solid':
      return 'tone-ok';
    case 'Getting there':
      return 'tone-warn';
    case 'Learning':
      return 'tone-neutral';
    default:
      return 'tone-neutral';
  }
}

export function MasteryPill({ label }: { label: MasteryLabel }) {
  return <span className={`pill-label ${masteryTone(label)}`}>{label}</span>;
}
