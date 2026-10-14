import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export default function Topbar({ title, back, children }: { title?: ReactNode; back?: boolean | string; children?: ReactNode }) {
  const nav = useNavigate();
  return (
    <header className="topbar">
      {back && (
        <button
          className="iconbtn"
          aria-label="Back"
          onClick={() => {
            if (typeof back === 'string') nav(back);
            else if (window.history.length > 1) nav(-1);
            else nav('/');
          }}
        >
          <ArrowLeft size={22} />
        </button>
      )}
      {title !== undefined ? <h1>{title}</h1> : <div className="spacer" />}
      {children}
    </header>
  );
}
