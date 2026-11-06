(function () {
  'use strict';
  const { $, h, api, toast, debounce, downloadCSV, badge, emptyRow, handleAuthError } = window.TT;
  const PAGE_SIZE = 20;
  let page = 1, pages = 1, users = [], me = null;
  const fail = (err) => { if (!handleAuthError(err)) toast(err.message, true); };
  const when = (iso) => new Date(iso).toLocaleString();

  async function loadUsers() {
    const params = new URLSearchParams({ page, limit: PAGE_SIZE });
    if ($('#searchUser').value.trim()) params.set('search', $('#searchUser').value.trim());
    if ($('#filterRole').value) params.set('role', $('#filterRole').value);
    let res;
    try { res = await api(`/api/admin/users?${params}`); } catch (err) { $('#userBody').replaceChildren(emptyRow(5, 'Unable to load users.')); return fail(err); }
    users = res.data; pages = res.meta.pages;
    const c = res.counts;
    $('#adminCount').textContent = c.admin || 0; $('#controllerCount').textContent = c.controller || 0; $('#passengerCount').textContent = c.passenger || 0;
    $('#totalUsers').textContent = (c.admin || 0) + (c.controller || 0) + (c.passenger || 0);
    $('#pageInfo').textContent = `Page ${res.meta.page} of ${pages} (${res.meta.total} users)`;
    $('#prevPage').disabled = page <= 1; $('#nextPage').disabled = page >= pages;

    $('#userBody').replaceChildren(...(users.length ? users.map((u) => {
      const self = me && u._id === me._id;
      const roleSel = h('select', { 'aria-label': `Role for ${u.name}`, disabled: self, onchange: (e) => update(u._id, { role: e.target.value }) },
        ...['passenger', 'controller', 'admin'].map((r) => h('option', { value: r, selected: r === u.role }, r[0].toUpperCase() + r.slice(1))));
      return h('tr', {},
        h('td', {}, u.name), h('td', { className: 'muted' }, u.email), h('td', {}, roleSel),
        h('td', {}, badge(u.active ? 'Active' : 'Inactive', u.active ? 'badge-green' : 'badge-red')),
        h('td', {}, h('div', { className: 'actions' },
          h('button', { className: 'btn btn-secondary btn-sm', type: 'button', disabled: self, onclick: () => update(u._id, { active: !u.active }) }, u.active ? 'Deactivate' : 'Activate'),
          h('button', { className: 'btn btn-danger btn-sm', type: 'button', disabled: self, 'aria-label': `Delete ${u.name}`, onclick: () => remove(u) }, 'Delete'))));
    }) : [emptyRow(5, 'No users found.')]));
  }

  async function update(id, change) {
    try { await api(`/api/admin/users/${id}`, { method: 'PUT', body: change }); toast('User updated'); loadAudit(); }
    catch (err) { fail(err); }
    loadUsers();
  }
  async function remove(u) {
    if (!confirm(`Delete ${u.name} (${u.email})? This cannot be undone.`)) return;
    try { await api(`/api/admin/users/${u._id}`, { method: 'DELETE' }); toast('User deleted'); loadAudit(); }
    catch (err) { fail(err); }
    loadUsers();
  }

  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#addMsg'); msg.className = 'form-msg'; msg.textContent = '';
    if (!e.target.reportValidity()) return;
    try {
      await api('/api/admin/users', { method: 'POST', body: { name: $('#newName').value.trim(), email: $('#newEmail').value.trim(), role: $('#newRole').value, password: $('#newPassword').value } });
      msg.className = 'form-msg ok'; msg.textContent = 'User created.'; e.target.reset(); loadUsers(); loadAudit();
    } catch (err) { if (!handleAuthError(err)) { msg.className = 'form-msg err'; msg.textContent = err.message; } }
  });

  async function loadAudit() {
    try {
      const { data } = await api('/api/admin/audit-logs?limit=10');
      $('#auditBody').replaceChildren(...(data.length ? data.map((a) => h('tr', {}, h('td', {}, when(a.createdAt)), h('td', {}, a.actorEmail || 'system'), h('td', {}, a.action))) : [emptyRow(3, 'No activity yet.')]));
    } catch { $('#auditBody').replaceChildren(emptyRow(3, 'Unable to load.')); }
  }
  async function loadMessages() {
    try {
      const { data } = await api('/api/admin/messages?limit=10');
      $('#msgBody').replaceChildren(...(data.length ? data.map((m) => h('tr', {}, h('td', {}, `${m.name} <${m.email}>`), h('td', {}, m.message), h('td', {}, when(m.createdAt)))) : [emptyRow(3, 'No messages.')]));
    } catch { $('#msgBody').replaceChildren(emptyRow(3, 'Unable to load.')); }
  }

  $('#searchUser').addEventListener('input', debounce(() => { page = 1; loadUsers(); }));
  $('#filterRole').addEventListener('change', () => { page = 1; loadUsers(); });
  $('#prevPage').addEventListener('click', () => { page -= 1; loadUsers(); });
  $('#nextPage').addEventListener('click', () => { page += 1; loadUsers(); });
  $('#exportUsers').addEventListener('click', () => users.length
    ? downloadCSV('users.csv', ['Name', 'Email', 'Role', 'Status'], users.map((u) => [u.name, u.email, u.role, u.active ? 'Active' : 'Inactive']))
    : toast('Nothing to export', true));

  (window.TT.ready || Promise.resolve()).then(async () => { me = await window.TT.currentUser(); loadUsers(); loadAudit(); loadMessages(); });
})();
