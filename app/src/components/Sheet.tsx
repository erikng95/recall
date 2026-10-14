import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Bottom sheet (phones) / centered dialog (desktop) on a native <dialog>. */
export default function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      d.focus(); // don't land focus (and a ring) on the first control
    }
    if (!open && d.open) d.close();
  }, [open]);

  // Android back button / gesture closes the sheet instead of leaving the page.
  useEffect(() => {
    if (!open) return;
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
      window.removeEventListener('popstate', onPop);
      if (pushed && !popped && (window.history.state as { recallSheet?: boolean } | null)?.recallSheet) window.history.back();
    };
  }, [open]);

  return createPortal(
    <dialog
      ref={ref}
      className="sheet"
      tabIndex={-1}
      onCancel={(e) => {
        e.preventDefault();
        onCloseRef.current();
      }}
      onClick={(e) => {
        // click on the backdrop (outside the content box) closes
        if (e.target === ref.current) {
          const r = ref.current.getBoundingClientRect();
          const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
          if (!inside) onCloseRef.current();
        }
      }}
    >
      {open && (
        <>
          <div className="grip" />
          {title && <h2>{title}</h2>}
          {children}
        </>
      )}
    </dialog>,
    document.body,
  );
}
