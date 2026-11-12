(function () {
  'use strict';
  const { $, api } = window.TT;
  const msg = $('#authMsg');
  const forms = { login: $('#loginForm'), register: $('#registerForm') };
  const tabs = { login: $('#tabLogin'), register: $('#tabRegister') };
  const requestResetForm = $('#requestResetForm');
  const completeResetForm = $('#completeResetForm');
  let resetToken = '';

  function show(which) {
    requestResetForm.hidden = true;
    completeResetForm.hidden = true;
    for (const k of Object.keys(forms)) {
      forms[k].hidden = k !== which;
      tabs[k].setAttribute('aria-selected', String(k === which));
    }
    $('#authTitle').textContent = which === 'login' ? 'Welcome back' : 'Create your account';
    msg.textContent = '';
  }
  function showResetRequest() {
    for (const form of Object.values(forms)) form.hidden = true;
    requestResetForm.hidden = false;
    completeResetForm.hidden = true;
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
      const result = await api(path, { method: 'POST', body });
      const { user } = result;
      if (path.endsWith('/register') && result.email?.status !== 'accepted') {
        e.target.querySelector('button[type=submit]').disabled = false;
        msg.className = 'form-msg err';
        msg.textContent = `Account created, but the verification email was ${result.email?.status || 'not sent'}. Email delivery must be configured; sign-in is still available.`;
        return;
      }
      location.href = safeNext(user.role);
    } catch (err) {
      msg.className = 'form-msg err'; msg.textContent = err.message; btn.disabled = false;
    }
  }
  forms.login.addEventListener('submit', (e) => submit(e, '/api/auth/login', { email: $('#lEmail').value.trim(), password: $('#lPassword').value }));
  forms.register.addEventListener('submit', (e) => submit(e, '/api/auth/register', { name: $('#rName').value.trim(), email: $('#rEmail').value.trim(), password: $('#rPassword').value }));

  $('#showReset').addEventListener('click', showResetRequest);
  $('#backToLogin').addEventListener('click', () => show('login'));
  requestResetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    try {
      const result = await api('/api/auth/password-reset/request', {
        method: 'POST', body: { email: $('#resetEmail').value.trim() },
      });
      msg.className = 'form-msg ok'; msg.textContent = result.message;
    } catch (error) { msg.className = 'form-msg err'; msg.textContent = error.message; }
  });
  completeResetForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!event.target.reportValidity()) return;
    try {
      const result = await api('/api/auth/password-reset/complete', {
        method: 'POST', body: { token: resetToken, password: $('#newPassword').value },
      });
      history.replaceState(null, '', location.pathname);
      resetToken = '';
      msg.className = result.email?.status === 'accepted' ? 'form-msg ok' : 'form-msg err';
      msg.textContent = `${result.message} Security email status: ${result.email?.status || 'unknown'}.`;
      completeResetForm.hidden = true;
      forms.login.hidden = false;
      tabs.login.setAttribute('aria-selected', 'true');
      tabs.register.setAttribute('aria-selected', 'false');
    } catch (error) { msg.className = 'form-msg err'; msg.textContent = error.message; }
  });

  const query = new URLSearchParams(location.search);
  const verificationToken = query.get('verifyToken');
  resetToken = query.get('resetToken') || '';
  if (verificationToken) {
    history.replaceState(null, '', location.pathname);
    api('/api/auth/verify-email', { method: 'POST', body: { token: verificationToken } })
      .then((result) => { msg.className = 'form-msg ok'; msg.textContent = result.message; })
      .catch((error) => { msg.className = 'form-msg err'; msg.textContent = error.message; });
  }
  if (resetToken) {
    for (const form of Object.values(forms)) form.hidden = true;
    completeResetForm.hidden = false;
    requestResetForm.hidden = true;
    tabs.login.setAttribute('aria-selected', 'true');
    tabs.register.setAttribute('aria-selected', 'false');
    $('#authTitle').textContent = 'Choose a new password';
  }
})();
