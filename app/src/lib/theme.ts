import type { Settings } from '../store.ts';

let mq: MediaQueryList | undefined;

/** Theme = color-scheme on <html> (tokens use light-dark()). data-theme always holds the resolved value. */
export function applyTheme(theme: Settings['theme']) {
  const root = document.documentElement;
  const resolve = () => {
    const dark = theme === 'dark' || (theme === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    root.dataset.theme = dark ? 'dark' : 'light';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121217' : '#f7f7fa');
  };
  resolve();
  mq?.removeEventListener('change', resolve);
  mq = window.matchMedia('(prefers-color-scheme: dark)');
  if (theme === 'auto') mq.addEventListener('change', resolve);
}
