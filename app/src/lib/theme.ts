import type { Settings } from '../store.ts';

let mq: MediaQueryList | undefined;

export function applyTheme(theme: Settings['theme']) {
  const root = document.documentElement;
  const resolve = () => {
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0f1117' : '#f6f7fb');
  };
  resolve();
  mq?.removeEventListener('change', resolve);
  if (theme === 'auto') {
    mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', resolve);
  }
}
