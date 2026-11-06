/* Shared helpers for all pages. Everything user-supplied is rendered with textContent (never innerHTML). */
(function () {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);

  /** Tiny hyperscript: h('td', { className: 'x', onclick: fn }, 'text', childNode). Strings become text nodes. */
  function h(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props || {})) {
      if (value == null || value === false) continue;
      if (key === 'className') node.className = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
      else if (value === true) node.setAttribute(key, '');
      else node.setAttribute(key, value);
    }
    for (const child of children.flat()) {
      if (child == null || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  class ApiError extends Error {
    constructor(message, status, details) { super(message); this.status = status; this.details = details; }
  }

  async function api(path, { method = 'GET', body } = {}) {
    let res;
    try {
      res = await fetch(path, {
        method,
        credentials: 'same-origin',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const detail = Array.isArray(data?.details) ? data.details.map((d) => `${d.field}: ${d.message}`).join('; ') : '';
      throw new ApiError([data?.error || `Request failed (${res.status})`, detail].filter(Boolean).join(': '), res.status, data?.details);
    }
    return data;
  }

  function toast(message, isError = false) {
    document.querySelector('.toast')?.remove();
    const t = h('div', { className: `toast${isError ? ' err' : ''}`, role: isError ? 'alert' : 'status' }, message);
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  /** Safe CSV: quotes cells and neutralises spreadsheet formula injection (=, +, -, @). */
  function csvCell(v) {
    let s = v == null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadCSV(filename, header, rows) {
    const csv = [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = h('a', { href: url, download: filename });
    document.body.append(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  const STATUS_BADGE = { 'On Time': 'badge-green', 'On Track': 'badge-green', Departed: 'badge-green', Delayed: 'badge-yellow', Critical: 'badge-red', Cancelled: 'badge-red' };
  const badge = (text, cls) => h('span', { className: `badge ${cls || STATUS_BADGE[text] || 'badge-yellow'}` }, text);
  const emptyRow = (cols, text) => h('tr', {}, h('td', { className: 'empty', colspan: cols }, text));

  async function currentUser() {
    try { return (await api('/api/auth/me')).user; } catch { return null; }
  }

  async function logout() {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* ignore */ }
    location.href = '/login';
  }

  /** Builds the top navigation; staff-only links appear only for the matching roles. */
  async function initNav() {
    const host = $('#siteNav');
    if (!host) return null;
    const user = await currentUser();
    const here = location.pathname;
    const link = (href, label) => h('a', { href, 'aria-current': here === href ? 'page' : null }, label);
    const links = h('div', { className: 'nav-links' },
      link('/', 'Home'), link('/passenger', 'Passenger'),
      user && ['controller', 'admin'].includes(user.role) ? link('/controller', 'Controller') : null,
      user?.role === 'admin' ? link('/admin', 'Admin') : null,
      link('/contact', 'Contact'),
      user
        ? [h('span', { className: 'nav-user' }, `${user.name} (${user.role})`), h('button', { type: 'button', onclick: logout }, 'Logout')]
        : link('/login', 'Login'));
    host.replaceChildren(h('div', { className: 'nav-inner' }, h('a', { className: 'logo', href: '/' }, '🚆 TrainTrack AI'), h('nav', { 'aria-label': 'Main' }, links)));
    return user;
  }

  /** Staff pages call this: bounce to login if the session expired mid-use. */
  function handleAuthError(err) {
    if (err?.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return true; }
    return false;
  }

  window.TT = { $, h, api, ApiError, toast, debounce, downloadCSV, badge, emptyRow, initNav, handleAuthError, currentUser };
  document.addEventListener('DOMContentLoaded', () => { window.TT.ready = initNav(); });
})();
