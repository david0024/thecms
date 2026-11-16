/**
 * Runs inside the editor's canvas: the real page, drawn by the same renderer
 * as the public site, with marks on what can be edited. It turns that page
 * into an editing surface and reports to the admin around it.
 *
 * It never changes content itself. Every change is sent up, the admin changes
 * the document, and the server draws it again. (The approach is MYCMS's.)
 */
import { domToRichText } from './richdom.ts';

type Up =
  | { type: 'ready' }
  | { type: 'select'; id: string | null }
  | { type: 'edit'; id: string; path: string; value: unknown }
  | { type: 'action'; id: string; action: 'up' | 'down' | 'duplicate' | 'delete' };

interface Render {
  type: 'render';
  body: string;
  css: string;
  selected: string | null;
  /** Bumped when the theme changed, so the stylesheet is fetched again. */
  themeVersion: number;
  labels: { types: Record<string, string>; fields: Record<string, string>; empty: Record<string, string>; actions: Record<string, string> };
}

const post = (message: Up): void => parent.postMessage({ thecms: true, ...message }, location.origin);

const root = document.getElementById('cms-root') as HTMLElement;
const own = document.getElementById('cms-own') as HTMLStyleElement;
const themeLink = document.getElementById('cms-theme') as HTMLLinkElement;

let selected: string | null = null;
let labels: Render['labels'] = { types: {}, fields: {}, empty: {}, actions: {} };
let themeVersion = 0;

const style = document.createElement('style');
style.textContent = `
[data-b]{position:relative;cursor:default}
[data-b]:hover:not(:has([data-b]:hover)){outline:1px dashed #6d5dfc;outline-offset:-1px}
[data-b].cms-selected{outline:2px solid #6d5dfc!important;outline-offset:-2px}
[data-edit],[data-edit-rich]{cursor:text;min-width:1ch}
[data-edit]:focus,[data-edit-rich]:focus{outline:2px dashed #6d5dfc;outline-offset:3px}
[data-edit]:empty::before{content:attr(data-placeholder);opacity:.45}
.cms-empty{display:grid;place-items:center;min-height:6rem;border:2px dashed #b9b3ff;border-radius:8px;color:#6d5dfc;font:500 14px/1.4 system-ui,sans-serif}
.cms-empty::after{content:attr(data-label)}
.cms-bar{position:absolute;top:0;inset-inline-end:0;z-index:10;display:flex;background:#6d5dfc;color:#fff;border-radius:0 0 0 6px;font:600 12px/1 system-ui,sans-serif;text-align:start}
.cms-bar span{display:flex;align-items:center;padding:0 10px}
.cms-bar button{width:28px;height:28px;padding:0;border:0;background:none;color:inherit;font:inherit;cursor:pointer}
.cms-bar button:hover{background:rgb(255 255 255/.2)}
a{cursor:default}
`;
document.head.append(style);

const blockOf = (node: EventTarget | null): HTMLElement | null => (node instanceof Element ? node.closest<HTMLElement>('[data-b]') : null);

function toolbar(block: HTMLElement): HTMLElement {
  const bar = document.createElement('div');
  bar.className = 'cms-bar';
  bar.contentEditable = 'false';
  const name = document.createElement('span');
  name.textContent = labels.types[block.dataset.type ?? ''] ?? block.dataset.type ?? '';
  bar.append(name);
  for (const [action, glyph] of [['up', '↑'], ['down', '↓'], ['duplicate', '⧉'], ['delete', '✕']] as const) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = glyph;
    button.title = labels.actions[action] ?? action;
    button.setAttribute('aria-label', button.title);
    button.dataset.action = action;
    bar.append(button);
  }
  return bar;
}

function showSelection(): void {
  for (const el of root.querySelectorAll('.cms-selected')) el.classList.remove('cms-selected');
  for (const el of root.querySelectorAll('.cms-bar')) el.remove();
  if (!selected) return;
  const block = root.querySelector<HTMLElement>(`[data-b="${CSS.escape(selected)}"]`);
  if (!block) return;
  block.classList.add('cms-selected');
  block.append(toolbar(block));
}

function prepare(): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-edit]')) {
    el.contentEditable = 'plaintext-only';
    el.spellcheck = true;
    const field = (el.dataset.edit ?? '').split('.').pop() ?? '';
    el.dataset.placeholder = labels.fields[field] ?? field;
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-edit-rich]')) {
    el.contentEditable = 'true';
    el.spellcheck = true;
  }
  for (const el of root.querySelectorAll<HTMLElement>('.cms-empty')) {
    el.dataset.label = labels.empty[el.dataset.empty ?? ''] ?? '';
  }
}

window.addEventListener('message', (event) => {
  if (event.origin !== location.origin || event.source !== parent) return;
  const message = event.data as Render;
  if (message?.type !== 'render') return;
  labels = message.labels;
  selected = message.selected;
  // `body` is our own server's rendering of the document, every string escaped.
  root.innerHTML = message.body;
  own.textContent = message.css;
  if (message.themeVersion !== themeVersion) {
    themeVersion = message.themeVersion;
    themeLink.href = `/assets/site.css?v=${themeVersion}`;
  }
  prepare();
  showSelection();
});

document.addEventListener('click', (event) => {
  const target = event.target as Element;
  const button = target.closest<HTMLElement>('.cms-bar button');
  if (button && selected) {
    event.preventDefault();
    post({ type: 'action', id: selected, action: button.dataset.action as 'up' });
    return;
  }
  // The page is being edited, not visited: links do not navigate.
  if (target.closest('a')) event.preventDefault();
  const id = blockOf(target)?.dataset.b ?? null;
  if (id !== selected) {
    selected = id;
    showSelection();
    post({ type: 'select', id });
  }
});

document.addEventListener('input', (event) => {
  const target = event.target as HTMLElement;
  const id = blockOf(target)?.dataset.b;
  if (!id) return;
  const rich = target.closest<HTMLElement>('[data-edit-rich]');
  if (rich) {
    post({ type: 'edit', id, path: rich.dataset.editRich as string, value: domToRichText(rich) });
    return;
  }
  const plain = target.closest<HTMLElement>('[data-edit]');
  if (plain) post({ type: 'edit', id, path: plain.dataset.edit as string, value: plain.innerText.replace(/\n$/, '') });
});

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if (event.key === 'Escape') target.blur();
  // A one-line field stays one line.
  if (event.key === 'Enter' && target.matches('[data-edit]:not([data-multiline])')) event.preventDefault();
});

// Pasting brings words, never markup.
document.addEventListener('paste', (event) => {
  const target = event.target as HTMLElement;
  if (!target.closest('[data-edit-rich]')) return;
  event.preventDefault();
  document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') ?? '');
});

post({ type: 'ready' });
