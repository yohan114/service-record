// ============================================================
//  User management (admin only)
// ============================================================
async function loadUsers() {
    if (!isAdmin()) { location.hash = '#/dashboard'; return; }
    const box = document.getElementById('users-list');
    box.innerHTML = '<div class="loading">Loading…</div>';
    try {
        const users = await api('/api/users');
        box.innerHTML = `
        <table class="data-table users-table">
            <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last sign-in</th><th class="ta-right">Actions</th></tr></thead>
            <tbody>${users.map(userRow).join('')}</tbody>
        </table>`;
    } catch (e) { box.innerHTML = '<div class="empty-note err">Error: ' + esc(e.message) + '</div>'; }
}

function userRow(u) {
    const me = u.id === (currentUser && currentUser.id);
    return `
    <tr>
        <td>
            <div class="u-name">${esc(u.fullName || u.username)} ${me ? '<span class="pill">you</span>' : ''}</div>
            <div class="muted small">@${esc(u.username)}</div>
        </td>
        <td><span class="role-badge ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? 'Admin' : 'User'}</span></td>
        <td>${u.active ? '<span class="status-on">Active</span>' : '<span class="status-off">Disabled</span>'}${u.mustChangePassword ? '<div class="muted small">must reset password</div>' : ''}</td>
        <td class="muted small">${u.lastLoginAt ? fmtDate(u.lastLoginAt) : 'never'}</td>
        <td class="ta-right">
            <button class="btn btn-mini btn-secondary" onclick="resetUserPassword(${u.id}, '${esc(u.username)}')">Reset password</button>
            <button class="btn btn-mini btn-secondary" onclick="toggleUserRole(${u.id}, '${u.role}')">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button>
            <button class="btn btn-mini btn-secondary" onclick="toggleUserActive(${u.id}, ${u.active ? 1 : 0})" ${me ? 'disabled' : ''}>${u.active ? 'Disable' : 'Enable'}</button>
            <button class="btn btn-mini btn-danger" onclick="deleteUser(${u.id}, '${esc(u.username)}')" ${me ? 'disabled' : ''}>Delete</button>
        </td>
    </tr>`;
}

function openAddUser() {
    document.getElementById('addUserForm').reset();
    document.getElementById('au-err').textContent = '';
    document.getElementById('au-password').value = suggestPassword();
    openModal('addUserModal');
    setTimeout(() => document.getElementById('au-username').focus(), 60);
}

function suggestPassword() {
    const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
    let s = '';
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s;
}

async function submitAddUser(e) {
    e.preventDefault();
    const body = {
        username: document.getElementById('au-username').value.trim(),
        fullName: document.getElementById('au-fullname').value.trim(),
        password: document.getElementById('au-password').value,
        role: document.getElementById('au-role').value
    };
    const err = document.getElementById('au-err');
    err.textContent = '';
    try {
        await api('/api/users', 'POST', body);
        toast('User created');
        closeModal('addUserModal');
        loadUsers();
    } catch (e2) { err.textContent = e2.message; }
}

async function toggleUserActive(id, active) {
    try { await api('/api/users/' + id, 'PUT', { active: !active }); loadUsers(); }
    catch (e) { toast(e.message, 'err'); }
}
async function toggleUserRole(id, role) {
    const next = role === 'admin' ? 'user' : 'admin';
    if (!confirm(`Change this user's role to ${next}?`)) return;
    try { await api('/api/users/' + id, 'PUT', { role: next }); loadUsers(); }
    catch (e) { toast(e.message, 'err'); }
}
async function resetUserPassword(id, username) {
    const np = prompt(`Set a new temporary password for "${username}" (min 6 chars). They will be asked to change it at next sign-in.`);
    if (np == null) return;
    try { await api('/api/users/' + id + '/reset-password', 'POST', { newPassword: np }); toast('Password reset'); loadUsers(); }
    catch (e) { toast(e.message, 'err'); }
}
async function deleteUser(id, username) {
    if (!confirm(`Delete user "${username}"? This cannot be undone.`)) return;
    try { await api('/api/users/' + id, 'DELETE'); toast('User deleted'); loadUsers(); }
    catch (e) { toast(e.message, 'err'); }
}
