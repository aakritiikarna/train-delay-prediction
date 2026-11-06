(function () {
  'use strict';
  const { $, api } = window.TT;
  const msg = $('#authMsg');
  const forms = { login: $('#loginForm'), register: $('#registerForm') };
  const tabs = { login: $('#tabLogin'), register: $('#tabRegister') };

  function show(which) {
    for (const k of Object.keys(forms)) {
      forms[k].hidden = k !== which;
      tabs[k].setAttribute('aria-selected', String(k === which));
    }
    $('#authTitle').textContent = which === 'login' ? 'Welcome back' : 'Create your account';
    msg.textContent = '';
  }
  tabs.login.addEventListener('click', () => show('login'));
  tabs.register.addEventListener('click', () => show('register'));

  // Only follow same-site relative redirects (prevents open-redirect abuse of ?next=).
  function safeNext(role) {
    const next = new URLSearchParams(location.search).get('next');
    if (next && /^\/[A-Za-z0-9_\-/]*$/.test(next) && !next.startsWith('//')) return next;
    return role === 'admin' ? '/admin' : role === 'controller' ? '/controller' : '/passenger';
  }

  async function submit(e, path, body) {
    e.preventDefault();
    msg.className = 'form-msg';
    msg.textContent = '';
    if (!e.target.reportValidity()) return;
    const btn = e.target.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const { user } = await api(path, { method: 'POST', body });
      location.href = safeNext(user.role);
    } catch (err) {
      msg.className = 'form-msg err'; msg.textContent = err.message; btn.disabled = false;
    }
  }
  forms.login.addEventListener('submit', (e) => submit(e, '/api/auth/login', { email: $('#lEmail').value.trim(), password: $('#lPassword').value }));
  forms.register.addEventListener('submit', (e) => submit(e, '/api/auth/register', { name: $('#rName').value.trim(), email: $('#rEmail').value.trim(), password: $('#rPassword').value }));
})();
