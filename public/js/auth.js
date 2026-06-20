// ============================================================
//  Authentication: login gate, account menu, password change
// ============================================================
let currentUser = null;

function isAdmin() { return currentUser && currentUser.role === 'admin'; }

function showLogin(hint) {
    document.getElementById('loginScreen').style.display = 'flex';
    if (hint) document.getElementById('login-hint').innerHTML = hint;
    setTimeout(() => document.getElementById('login-user').focus(), 60);
}
function hideLogin() { document.getElementById('loginScreen').style.display = 'none'; }

function togglePw(id, btn) {
    const el = document.getElementById(id);
    el.type = el.type === 'password' ? 'text' : 'password';
    btn.textContent = el.type === 'password' ? 'show' : 'hide';
}

async function doLogin(e) {
    e.preventDefault();
    const username = document.getElementById('login-user').value.trim();
    const password = document.getElementById('login-pass').value;
    const errEl = document.getElementById('login-err');
    const btn = document.getElementById('login-btn');
    errEl.textContent = '';
    btn.disabled = true; btn.textContent = 'Signing in…';
    try {
        const res = await api('/api/auth/login', 'POST', { username, password });
        currentUser = res.user;
        document.getElementById('login-pass').value = '';
        document.getElementById('loginForm').reset();
        hideLogin();
        await onAuthenticated();
    } catch (err) {
        errEl.textContent = err.message || 'Login failed';
    } finally {
        btn.disabled = false; btn.textContent = 'Sign In';
    }
}

async function doLogout() {
    closeAccountMenu();
    try { await api('/api/auth/logout', 'POST'); } catch {}
    currentUser = null;
    document.body.classList.remove('is-admin');
    showLogin('You have been signed out.');
}

function renderAccount(user) {
    const initials = (user.fullName || user.username || '?').trim().slice(0, 1).toUpperCase();
    document.getElementById('acc-avatar').textContent = initials;
    document.getElementById('acc-name').textContent = user.fullName || user.username;
    document.getElementById('acc-role').textContent = user.role === 'admin' ? 'Administrator' : 'User';
    document.getElementById('acc-users-btn').style.display = user.role === 'admin' ? 'flex' : 'none';
    document.body.classList.toggle('is-admin', user.role === 'admin');
    // Settings are admin-only on the server — hide the nav item for plain users
    const navSettings = document.getElementById('nav-settings');
    if (navSettings) navSettings.style.display = user.role === 'admin' ? '' : 'none';
}

function toggleAccountMenu() { document.getElementById('accountMenu').classList.toggle('open'); }
function closeAccountMenu() { document.getElementById('accountMenu').classList.remove('open'); }
document.addEventListener('click', e => { if (!e.target.closest('.account-box')) closeAccountMenu(); });

function goUsers() { closeAccountMenu(); location.hash = '#/users'; }

// ---------------- Change password ----------------
function openChangePassword(force) {
    closeAccountMenu();
    document.getElementById('changePwForm').reset();
    document.getElementById('pw-err').textContent = '';
    const note = document.getElementById('pw-force-note');
    note.style.display = force ? 'block' : 'none';
    if (force) note.textContent = 'For security, please replace the temporary password before you continue.';
    openModal('changePwModal');
    setTimeout(() => document.getElementById('pw-current').focus(), 60);
}

async function submitChangePassword(e) {
    e.preventDefault();
    const cur = document.getElementById('pw-current').value;
    const nw = document.getElementById('pw-new').value;
    const cf = document.getElementById('pw-confirm').value;
    const err = document.getElementById('pw-err');
    err.textContent = '';
    if (nw !== cf) { err.textContent = 'The new passwords do not match.'; return; }
    if (nw.length < 6) { err.textContent = 'New password must be at least 6 characters.'; return; }
    try {
        await api('/api/auth/change-password', 'POST', { currentPassword: cur, newPassword: nw });
        toast('Password updated');
        closeModal('changePwModal');
        if (currentUser) currentUser.mustChangePassword = false;
    } catch (e2) { err.textContent = e2.message; }
}
