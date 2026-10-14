import { Marked, type TokenizerAndRendererExtension } from 'marked';
import DOMPurify from 'dompurify';

const wikilink: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start(src: string) {
    return src.indexOf('[[');
  },
  tokenizer(src: string) {
    const m = /^\[\[([^\[\]|#]+)(#[^\[\]|]*)?(?:\|([^\[\]]+))?\]\]/.exec(src);
    if (m) {
      return { type: 'wikilink', raw: m[0], target: m[1].trim(), label: (m[3] ?? m[1]).trim() };
    }
    return undefined;
  },
  renderer(token) {
    const t = token as unknown as { target: string; label: string };
    return `<a class="wikilink" href="#" data-target="${escapeAttr(t.target)}">${escapeHtml(t.label)}</a>`;
  },
};

const highlight: TokenizerAndRendererExtension = {
  name: 'highlight',
  level: 'inline',
  start(src: string) {
    return src.indexOf('==');
  },
  tokenizer(src: string) {
    const m = /^==([^=\n]+)==/.exec(src);
    if (m) {
      return { type: 'highlight', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
    }
    return undefined;
  },
  renderer(token) {
    return `<mark>${this.parser.parseInline((token as unknown as { tokens: never[] }).tokens)}</mark>`;
  },
};

const marked = new Marked({ gfm: true, breaks: true });
marked.use({ extensions: [wikilink, highlight] });

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A' && !node.classList.contains('wikilink')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
function escapeAttr(s: string) {
  return escapeHtml(s);
}

export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(html, { ADD_ATTR: ['target', 'data-target'] });
}

/** Plain-text preview of markdown (for lists). */
export function plainSnippet(src: string, max = 140): string {
  const s = src
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/==([^=]+)==/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#>*_`~-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
