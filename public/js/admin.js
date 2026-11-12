(function () {
  'use strict';
  const { $, h, api, toast, debounce, downloadCSV, badge, emptyRow, handleAuthError } = window.TT;
  const PAGE_SIZE = 20;
  let page = 1, pages = 1, users = [], me = null;
  const fail = (err) => { if (!handleAuthError(err)) toast(err.message, true); };
  const when = (value) => value ? new Date(value).toLocaleString() : 'Never';

  async function loadOverview() {
    try {
      const data = await api('/api/admin/overview');
      $('#totalUsers').textContent = data.totalUsers;
      $('#adminCount').textContent = data.roleCounts.admin || 0;
      $('#controllerCount').textContent = data.roleCounts.controller || 0;
      $('#passengerCount').textContent = data.roleCounts.passenger || 0;
      $('#activeUsers').textContent = `${data.activeUsers} / ${data.totalUsers}`;
      $('#verifiedEmails').textContent = `${data.verifiedEmails} / ${data.totalUsers}`;
      $('#failedLogins').textContent = data.failedLoginsLast7Days;
    } catch (err) { fail(err); }
  }

  async function loadUsers() {
    const params = new URLSearchParams({ page, limit: PAGE_SIZE });
    if ($('#searchUser').value.trim()) params.set('search', $('#searchUser').value.trim());
    if ($('#filterRole').value) params.set('role', $('#filterRole').value);
    let res;
    try { res = await api(`/api/admin/users?${params}`); }
    catch (err) { $('#userBody').replaceChildren(emptyRow(7, 'Unable to load users.')); return fail(err); }
    users = res.data; pages = res.meta.pages;
    $('#pageInfo').textContent = `Page ${res.meta.page} of ${pages} (${res.meta.total} users)`;
    $('#prevPage').disabled = page <= 1; $('#nextPage').disabled = page >= pages;

    $('#userBody').replaceChildren(...(users.length ? users.map((u) => {
      const self = me && u._id === me._id;
      const roleSel = h('select', { 'aria-label': `Role for ${u.name}`, disabled: self, onchange: (e) => update(u._id, { role: e.target.value }) },
        ...['passenger', 'controller', 'admin'].map((role) => h('option', { value: role, selected: role === u.role }, role[0].toUpperCase() + role.slice(1))));
      return h('tr', {},
        h('td', {}, u.name), h('td', { className: 'muted' }, u.email),
        h('td', {}, badge(u.emailVerified ? 'Verified' : 'Not verified', u.emailVerified ? 'badge-green' : 'badge-yellow')),
        h('td', {}, roleSel),
        h('td', {}, badge(u.active ? 'Active' : 'Inactive', u.active ? 'badge-green' : 'badge-red')),
        h('td', { className: 'small' }, `Last login: ${when(u.lastLoginAt)}`, h('br'), `Created: ${when(u.createdAt)}`),
        h('td', {}, h('div', { className: 'actions' },
          h('button', { className: 'btn btn-secondary btn-sm', type: 'button', onclick: () => showUserDetails(u._id) }, 'Details'),
          h('button', { className: 'btn btn-secondary btn-sm', type: 'button', disabled: self, onclick: () => update(u._id, { active: !u.active }) }, u.active ? 'Deactivate' : 'Activate'),
          h('button', { className: 'btn btn-danger btn-sm', type: 'button', disabled: self, 'aria-label': `Delete ${u.name}`, onclick: () => remove(u) }, 'Delete'))));
    }) : [emptyRow(7, 'No users found.')]));
  }

  async function update(id, change) {
    try { await api(`/api/admin/users/${id}`, { method: 'PUT', body: change }); toast('User updated'); loadAudit(); loadOverview(); }
    catch (err) { fail(err); }
    loadUsers();
  }

  async function remove(user) {
    if (!confirm(`Delete ${user.name} (${user.email})? This cannot be undone.`)) return;
    try { await api(`/api/admin/users/${user._id}`, { method: 'DELETE' }); toast('User deleted'); loadAudit(); loadOverview(); }
    catch (err) { fail(err); }
    loadUsers();
  }

  async function showUserDetails(id) {
    try {
      const result = await api(`/api/admin/users/${id}`);
      const user = result.user;
      const content = $('#userDetailsContent');
      content.replaceChildren(
        h('dl', { className: 'details-list' },
          h('dt', {}, 'Name'), h('dd', {}, user.name),
          h('dt', {}, 'Email'), h('dd', {}, user.email),
          h('dt', {}, 'Email verification'), h('dd', {}, user.emailVerified ? 'Verified' : 'Not verified'),
          h('dt', {}, 'Role / account'), h('dd', {}, `${user.role} / ${user.active ? 'Active' : 'Inactive'}`),
          h('dt', {}, 'Account created'), h('dd', {}, when(user.createdAt)),
          h('dt', {}, 'Last successful login'), h('dd', {}, when(user.lastLoginAt))),
        h('h3', {}, 'Recent account activity'));
      const activity = result.auditLogs.map((entry) => h('li', {}, `${entry.action} · ${when(entry.createdAt)}`));
      const security = result.securityEvents.map((entry) => h('li', {}, `Failed sign-in (${entry.reason}) · ${when(entry.createdAt)}`));
      content.append(h('ul', { className: 'activity-feed' }, ...(activity.length ? activity : [h('li', { className: 'muted' }, 'No audit activity recorded.')])));
      content.append(h('h3', {}, 'Security events'));
      content.append(h('ul', { className: 'activity-feed' }, ...(security.length ? security : [h('li', { className: 'muted' }, 'No security events recorded.')])));
      $('#userDetailsDialog').showModal();
    } catch (err) { fail(err); }
  }

  $('#addForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('#addMsg'); msg.className = 'form-msg'; msg.textContent = '';
    if (!e.currentTarget.reportValidity()) return;
    try {
      await api('/api/admin/users', { method: 'POST', body: { name: $('#newName').value.trim(), email: $('#newEmail').value.trim(), role: $('#newRole').value, password: $('#newPassword').value } });
      msg.className = 'form-msg ok'; msg.textContent = 'User created.'; e.currentTarget.reset();
      loadUsers(); loadOverview(); loadAudit();
    } catch (err) { if (!handleAuthError(err)) { msg.className = 'form-msg err'; msg.textContent = err.message; } }
  });

  function filterDateParams(params, prefix) {
    const from = $(`#${prefix}From`).value, to = $(`#${prefix}To`).value;
    if (from && to && from > to) {
      toast('The start date must not be after the end date.', true);
      return false;
    }
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return true;
  }

  async function loadAudit() {
    const params = new URLSearchParams({ limit: '100' });
    const search = $('#auditSearch').value.trim();
    const action = $('#auditAction').value.trim();
    if (search) params.set('search', search);
    if (action) params.set('action', action);
    if (!filterDateParams(params, 'audit')) return;
    try {
      const { data } = await api(`/api/admin/audit-logs?${params}`);
      $('#auditBody').replaceChildren(...(data.length
        ? data.map((entry) => h('tr', {}, h('td', {}, when(entry.createdAt)), h('td', {}, entry.actorEmail || 'system'), h('td', {}, entry.action)))
        : [emptyRow(3, 'No matching activity.')]));
    } catch (err) { $('#auditBody').replaceChildren(emptyRow(3, 'Unable to load audit logs.')); fail(err); }
  }

  async function loadMessages() {
    const params = new URLSearchParams({ limit: '50' });
    if ($('#messageReadFilter').value) params.set('read', $('#messageReadFilter').value);
    try {
      const { data } = await api(`/api/admin/messages?${params}`);
      $('#msgBody').replaceChildren(...(data.length ? data.map((message) => h('tr', {},
        h('td', {}, `${message.name} <${message.email}>`), h('td', {}, message.message), h('td', {}, when(message.createdAt)),
        h('td', {}, h('div', { className: 'actions' }, badge(message.read ? 'Read' : 'Unread', message.read ? 'badge-green' : 'badge-yellow'),
          h('button', { className: 'btn btn-secondary btn-sm', type: 'button', onclick: () => setMessageRead(message) }, message.read ? 'Mark unread' : 'Mark read'))))) : [emptyRow(4, 'No messages.')]));
    } catch (err) { $('#msgBody').replaceChildren(emptyRow(4, 'Unable to load messages.')); fail(err); }
  }

  async function loadNotificationOverview() {
    try {
      const { data, total, unread, createdLast24Hours, emailStatuses } = await api('/api/admin/notifications/overview?limit=10');
      $('#notificationTotal').textContent = total;
      $('#notificationUnread').textContent = unread;
      $('#notificationRecent').textContent = createdLast24Hours;
      $('#notificationEmailFailures').textContent = emailStatuses.failed || 0;
      $('#adminNotificationBody').replaceChildren(...(data.length ? data.map((notification) => h('tr', {},
        h('td', {}, when(notification.createdAt)),
        h('td', {}, notification.user?.email || 'Deleted user'),
        h('td', {}, `${notification.title}: ${notification.message}`),
        h('td', {}, notification.emailStatus || 'not requested'))) : [emptyRow(4, 'No notifications yet.')]));
    } catch (err) {
      $('#adminNotificationBody').replaceChildren(emptyRow(4, 'Unable to load notification overview.'));
      fail(err);
    }
  }

  async function setMessageRead(message) {
    try {
      await api(`/api/admin/messages/${message._id}/read`, { method: 'PUT', body: { read: !message.read } });
      loadMessages(); loadAudit();
    } catch (err) { fail(err); }
  }

  async function loadSecurityEvents() {
    const params = new URLSearchParams({ limit: '100' });
    if ($('#securitySearch').value.trim()) params.set('search', $('#securitySearch').value.trim());
    if (!filterDateParams(params, 'security')) return;
    try {
      const { data } = await api(`/api/admin/security-events?${params}`);
      $('#securityBody').replaceChildren(...(data.length
        ? data.map((entry) => h('tr', {}, h('td', {}, when(entry.createdAt)), h('td', {}, entry.email), h('td', {}, entry.reason.replaceAll('_', ' ')), h('td', {}, entry.ip || 'Not recorded')))
        : [emptyRow(4, 'No matching security events.')]));
    } catch (err) { $('#securityBody').replaceChildren(emptyRow(4, 'Unable to load security events.')); fail(err); }
  }

  async function loadHealth() {
    try {
      const data = await api('/api/admin/system-health');
      const items = [
        ['Node.js API', data.nodeApi.status, `Node ${data.nodeApi.nodeVersion}, uptime ${data.nodeApi.uptimeSeconds}s`],
        ['MongoDB', data.mongodb.status],
        ['Flask ML API', data.flaskMlApi.status],
        ['CatBoost model', data.catboostModel.status],
        ['Email API', data.emailProvider.status, data.emailProvider.check],
        ['SMTP', data.smtp.status],
      ];
      $('#healthList').replaceChildren(...items.map(([name, status, detail]) => h('li', {},
        h('span', {}, name), badge(status, ['available', 'connected', 'reachable', 'not_configured'].includes(status) ? 'badge-green' : 'badge-red'),
        detail ? h('span', { className: 'muted small' }, detail) : null)));
    } catch (err) { $('#healthList').replaceChildren(h('li', { className: 'muted' }, 'Unable to load system health.')); fail(err); }
  }

  $('#searchUser').addEventListener('input', debounce(() => { page = 1; loadUsers(); }));
  $('#filterRole').addEventListener('change', () => { page = 1; loadUsers(); });
  $('#prevPage').addEventListener('click', () => { page -= 1; loadUsers(); });
  $('#nextPage').addEventListener('click', () => { page += 1; loadUsers(); });
  $('#exportUsers').addEventListener('click', () => users.length
    ? downloadCSV('users.csv', ['Name', 'Email', 'Email verified', 'Role', 'Status', 'Created', 'Last login'], users.map((u) => [u.name, u.email, u.emailVerified ? 'Yes' : 'No', u.role, u.active ? 'Active' : 'Inactive', u.createdAt, u.lastLoginAt]))
    : toast('Nothing to export', true));
  $('#auditSearch').addEventListener('input', debounce(loadAudit));
  $('#auditAction').addEventListener('input', debounce(loadAudit));
  $('#auditFrom').addEventListener('change', loadAudit);
  $('#auditTo').addEventListener('change', loadAudit);
  $('#securitySearch').addEventListener('input', debounce(loadSecurityEvents));
  $('#securityFrom').addEventListener('change', loadSecurityEvents);
  $('#securityTo').addEventListener('change', loadSecurityEvents);
  $('#messageReadFilter').addEventListener('change', loadMessages);
  $('#refreshHealth').addEventListener('click', loadHealth);
  $('#closeUserDetails').addEventListener('click', () => $('#userDetailsDialog').close());

  (window.TT.ready || Promise.resolve()).then(async () => {
    me = await window.TT.currentUser();
    loadUsers(); loadAudit(); loadMessages(); loadOverview(); loadHealth(); loadSecurityEvents(); loadNotificationOverview();
    window.TT.notificationSocket?.on('admin:notification-count', loadNotificationOverview);
  });
})();
