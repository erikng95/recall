import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import './index.css';
import App from './App.tsx';
import { useStore } from './store.ts';
import { applyTheme } from './lib/theme.ts';

registerSW({ immediate: true });
applyTheme(useStore.getState().settings.theme);

// Android share sheet → Recall: the manifest share_target sends ?share_text=…&share_url=…&share_title=…
async function handleShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const text = params.get('share_text') ?? '';
  const url = params.get('share_url') ?? '';
  const title = params.get('share_title') ?? '';
  if (!text && !url && !title) return;
  // Many apps put the URL inside the text field.
  const urlInText = !url ? /(https?:\/\/\S+)/.exec(text)?.[1] : undefined;
  const finalUrl = url || urlInText || '';
  const body = (urlInText ? text.replace(urlInText, '') : text).trim();
  const qs = new URLSearchParams();
  if (body) qs.set('text', body);
  if (finalUrl) qs.set('url', finalUrl);
  if (title) qs.set('title', title);
  qs.set('shared', '1');
  // Clean the URL and open the capture screen prefilled.
  window.history.replaceState(null, '', window.location.pathname + '#/capture?' + qs.toString());
}

void handleShareTarget();

// While typing on a phone, hide the bottom nav so the keyboard leaves more room.
const isField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file'].includes((el as HTMLInputElement).type)) || el.isContentEditable);
document.addEventListener('focusin', (e) => {
  if (isField(e.target)) document.body.classList.add('typing');
});
document.addEventListener('focusout', (e) => {
  if (isField(e.target)) document.body.classList.remove('typing');
});
void useStore.getState().init();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
