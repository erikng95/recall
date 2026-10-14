import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { lazy, Suspense, useEffect, useMemo } from 'react';
import { BookOpen, Brain, Compass, Home as HomeIcon, Inbox as InboxIcon, Network, Plus, Settings as SettingsIcon } from 'lucide-react';
import { useStore, isDue } from './store.ts';
import { live } from '@shared/vault.ts';
import { useToast } from './lib/toast.ts';
import Home from './pages/Home.tsx';
import Library from './pages/Library.tsx';
import NotePage from './pages/NotePage.tsx';
import TopicPage from './pages/TopicPage.tsx';
import Capture from './pages/Capture.tsx';
import Inbox from './pages/Inbox.tsx';
import Review from './pages/Review.tsx';
import Explore from './pages/Explore.tsx';
import Settings from './pages/Settings.tsx';

const Graph = lazy(() => import('./pages/Graph.tsx'));

const ICON = { size: 21, strokeWidth: 1.9 };

function useCounts() {
  const vault = useStore((s) => s.vault);
  return useMemo(() => {
    const now = Date.now();
    const due = live(vault.cards).filter((c) => isDue(c, now) && c.srs).length;
    const inbox = live(vault.inbox).filter((i) => i.status === 'new').length;
    return { due, inbox };
  }, [vault]);
}

function BottomNav() {
  const { due } = useCounts();
  return (
    <nav className="bottomnav" aria-label="Main">
      <NavLink to="/" end className="navitem">
        <span className="navicon">
          <HomeIcon {...ICON} />
        </span>
        Today
      </NavLink>
      <NavLink to="/library" className="navitem">
        <span className="navicon">
          <BookOpen {...ICON} />
        </span>
        Library
      </NavLink>
      <NavLink to="/capture" className="navfab" aria-label="Capture">
        <span>
          <Plus size={26} strokeWidth={2.4} />
        </span>
      </NavLink>
      <NavLink to="/review" className="navitem">
        <span className="navicon">
          <Brain {...ICON} />
        </span>
        Review
        {due > 0 && <span className="badge">{due > 99 ? '99+' : due}</span>}
      </NavLink>
      <NavLink to="/explore" className="navitem">
        <span className="navicon">
          <Compass {...ICON} />
        </span>
        Explore
      </NavLink>
    </nav>
  );
}

function Sidebar() {
  const { due, inbox } = useCounts();
  const S = { size: 18, strokeWidth: 1.9 };
  return (
    <aside className="sidebar">
      <div className="brand">
        <img src="./favicon.svg" alt="" /> Recall
      </div>
      <NavLink to="/capture" className="btn primary block capture-btn">
        <Plus size={18} /> Capture
      </NavLink>
      <NavLink to="/" end className="side">
        <HomeIcon {...S} /> Today
      </NavLink>
      <NavLink to="/inbox" className="side">
        <InboxIcon {...S} /> Inbox {inbox > 0 && <span className="badge accent">{inbox}</span>}
      </NavLink>
      <NavLink to="/library" className="side">
        <BookOpen {...S} /> Library
      </NavLink>
      <NavLink to="/review" className="side">
        <Brain {...S} /> Review {due > 0 && <span className="badge">{due}</span>}
      </NavLink>
      <NavLink to="/explore" className="side">
        <Compass {...S} /> Explore
      </NavLink>
      <NavLink to="/graph" className="side">
        <Network {...S} /> Graph
      </NavLink>
      <div className="grow" />
      <NavLink to="/settings" className="side">
        <SettingsIcon {...S} /> Settings
      </NavLink>
    </aside>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Toast() {
  const msg = useToast((s) => s.message);
  return msg ? (
    <div className="toast" role="status">
      {msg}
    </div>
  ) : null;
}

export default function App() {
  const loaded = useStore((s) => s.loaded);
  return (
    <HashRouter>
      <ScrollToTop />
      <div className="shell">
        <Sidebar />
        <main className="main">
          {loaded ? (
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/library" element={<Library />} />
              <Route path="/topic/:id" element={<TopicPage />} />
              <Route path="/note/:id" element={<NotePage />} />
              <Route path="/capture" element={<Capture />} />
              <Route path="/inbox" element={<Inbox />} />
              <Route path="/review" element={<Review />} />
              <Route path="/explore" element={<Explore />} />
              <Route
                path="/graph"
                element={
                  <Suspense fallback={null}>
                    <Graph />
                  </Suspense>
                }
              />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Home />} />
            </Routes>
          ) : null}
        </main>
        <BottomNav />
        <Toast />
      </div>
    </HashRouter>
  );
}
