import { ShieldCheck, ShieldAlert, ShieldQuestion, ShieldX, Shield } from 'lucide-react';
import { VERDICT_INFO, type Verification } from '@shared/vault.ts';

export function verdictIcon(tone: string, size = 14) {
  if (tone === 'good' || tone === 'ok') return <ShieldCheck size={size} />;
  if (tone === 'warn') return <ShieldAlert size={size} />;
  if (tone === 'bad') return <ShieldX size={size} />;
  if (tone === 'neutral') return <ShieldQuestion size={size} />;
  return <Shield size={size} />;
}

export default function VerdictBadge({ v, small, onClick }: { v?: Verification; small?: boolean; onClick?: () => void }) {
  if (!v || v.verdict === 'unchecked') return null;
  const info = VERDICT_INFO[v.verdict];
  const cls = `chip ${small ? 'sm' : ''} tone-${info.tone}`;
  const content = (
    <>
      {verdictIcon(info.tone, small ? 12 : 14)}
      {info.label}
      {v.confidence !== undefined && !small && <span style={{ opacity: 0.7 }}>· {Math.round(v.confidence * 100)}%</span>}
    </>
  );
  return onClick ? (
    <button className={cls} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className={cls}>{content}</span>
  );
}
