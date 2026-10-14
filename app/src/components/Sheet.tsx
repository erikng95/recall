import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export default function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCloseRef.current();
    window.addEventListener('keydown', onKey);
    // Android back button / gesture closes the sheet instead of leaving the page:
    // push a history entry while open, close on popstate.
    let pushed = false;
    let popped = false;
    const t = setTimeout(() => {
      window.history.pushState({ ...(window.history.state as object), recallSheet: true }, '');
      pushed = true;
    }, 0);
    const onPop = () => {
      if (!pushed) return;
      popped = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('popstate', onPop);
      // Closed via UI: drop the history entry we added.
      if (pushed && !popped && (window.history.state as { recallSheet?: boolean } | null)?.recallSheet) window.history.back();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="grip" />
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>,
    document.body,
  );
}
