/* Toast, floating menus, and navigation helpers (no view code here). */

import { $, icon, clamp } from './util.js';

let toastTimer = null;

export function toast(message, { action, onAction, duration = 4200 } = {}) {
  const el = $('#toast');
  if (!el) return;
  clearTimeout(toastTimer);
  el.innerHTML = `<span>${escapeText(message)}</span>${action ? `<button type="button">${escapeText(action)}</button>` : ''}`;
  if (action) {
    el.querySelector('button').addEventListener('click', () => {
      hideToast();
      onAction?.();
    }, { once: true });
  }
  el.classList.add('show');
  toastTimer = setTimeout(hideToast, duration);
}

export function hideToast() {
  const el = $('#toast');
  if (el) el.classList.remove('show');
}

function escapeText(s) {
  return String(s ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

export function navigate(path, { replace = false } = {}) {
  const current = location.pathname + location.search;
  if (path === current) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

let openMenuEl = null;
let openMenuCleanup = null;

export function closeMenu() {
  openMenuCleanup?.();
  openMenuEl?.remove();
  openMenuEl = null;
  openMenuCleanup = null;
}

export function openMenu(anchor, items) {
  closeMenu();
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.innerHTML = items
    .map((item) => {
      if (item.sep) return '<div class="sep"></div>';
      if (item.note) return `<div class="menu-note">${escapeText(item.note)}</div>`;
      if (item.href) {
        return `<a role="menuitem" href="${item.href}" data-link>${item.icon ? icon(item.icon) : ''}<span>${escapeText(item.label)}</span></a>`;
      }
      return `<button role="menuitem" type="button" data-key="${item.key}">${item.icon ? icon(item.icon) : ''}<span>${escapeText(item.label)}</span>${item.checked ? `<span class="checked">${icon('check')}</span>` : ''}</button>`;
    })
    .join('');
  document.body.append(menu);
  openMenuEl = menu;

  const rect = anchor.getBoundingClientRect();
  menu.style.visibility = 'hidden';
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  let left = anchor.dataset.align === 'left' ? rect.left : rect.right - mw;
  let top = rect.bottom + 8;
  if (top + mh > window.innerHeight - 8) top = rect.top - mh - 8;
  left = clamp(left, 8, window.innerWidth - mw - 8);
  top = clamp(top, 8, window.innerHeight - mh - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.style.visibility = '';

  menu.querySelectorAll('[data-key]').forEach((b) => {
    b.addEventListener('click', () => {
      const item = items.find((i) => i.key === b.dataset.key);
      closeMenu();
      item?.onClick?.();
    });
  });
  menu.querySelectorAll('a[data-link]').forEach((a) => a.addEventListener('click', () => closeMenu()));

  const onDown = (e) => {
    if (!menu.contains(e.target) && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      anchor.focus?.();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const focusables = [...menu.querySelectorAll('button, a')];
      if (!focusables.length) return;
      e.preventDefault();
      const idx = focusables.indexOf(document.activeElement);
      const next = e.key === 'ArrowDown' ? (idx + 1) % focusables.length : (idx - 1 + focusables.length) % focusables.length;
      focusables[next].focus();
    }
  };
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
  openMenuCleanup = () => {
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('resize', closeMenu);
    window.removeEventListener('scroll', closeMenu, true);
  };
}

/* In-app text prompt. WebView has no window.prompt(), so playlist naming and
   other small inputs use this instead. */
let dialogEl = null;
let dialogCleanup = null;

export function closePrompt() {
  if (!dialogEl) return;
  dialogEl.remove();
  dialogEl = null;
  dialogCleanup?.();
  dialogCleanup = null;
}

export function openPrompt({
  title = 'New playlist',
  label = 'Name',
  placeholder = '',
  value = '',
  hint = '',
  confirmText = 'Create',
  onSubmit,
} = {}) {
  closePrompt();
  const el = document.createElement('div');
  el.className = 'dialog-scrim';
  el.innerHTML = `<form class="dialog" role="dialog" aria-modal="true" aria-labelledby="dialogTitle">
    <h2 id="dialogTitle">${escapeText(title)}</h2>
    <label class="dialog-label" for="dialogInput">${escapeText(label)}</label>
    <input class="dialog-input" id="dialogInput" maxlength="40" autocomplete="off" spellcheck="false">
    <p class="dialog-hint" data-dialog-hint></p>
    <div class="dialog-actions">
      <button type="button" class="btn-outline" data-dialog-cancel>Cancel</button>
      <button type="submit" class="btn-primary">${escapeText(confirmText)}</button>
    </div>
  </form>`;
  document.body.append(el);
  dialogEl = el;

  const form = el.querySelector('form');
  const input = el.querySelector('.dialog-input');
  const hintEl = el.querySelector('[data-dialog-hint]');
  input.placeholder = placeholder;
  input.value = value;
  hintEl.textContent = hint;

  const close = () => closePrompt();

  const onKey = (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  el.querySelector('[data-dialog-cancel]').addEventListener('click', close);
  el.addEventListener('pointerdown', (event) => {
    if (event.target === el) close();
  });
  document.addEventListener('keydown', onKey);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = input.value.trim().replace(/\s+/g, ' ');
    if (!text) {
      hintEl.textContent = 'Please type a name first.';
      hintEl.dataset.tone = 'err';
      input.focus();
      return;
    }
    close();
    onSubmit?.(text);
  });

  dialogCleanup = () => document.removeEventListener('keydown', onKey);
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}
