(function () {
  'use strict';
  const { $, api } = window.TT;
  const form = $('#contactForm'), msg = $('#contactMsg');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.className = 'form-msg'; msg.textContent = '';
    if (!form.reportValidity()) return;
    const btn = form.querySelector('button'); btn.disabled = true;
    try {
      const res = await api('/api/contact', { method: 'POST', body: { name: form.name.value, email: form.email.value, message: form.message.value } });
      msg.className = 'form-msg ok'; msg.textContent = res.message; form.reset();
    } catch (err) {
      msg.className = 'form-msg err'; msg.textContent = err.message;
    } finally { btn.disabled = false; }
  });
})();
