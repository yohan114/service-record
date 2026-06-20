// ============================================================
//  Authentication & session layer
//  - scrypt password hashing (Node built-in crypto, no deps)
//  - opaque session tokens stored in the Sessions table
//  - httpOnly cookie helpers + Express middleware
// ============================================================

const crypto = require('crypto');
const { db } = require('./db');

const SESSION_COOKIE = 'ec_sid';
const SESSION_TTL_DAYS = 14;
const SCRYPT_KEYLEN = 64;

// ------------------------------------------------------------
//  Password hashing (scrypt with a per-user random salt)
// ------------------------------------------------------------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
    const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
    return { salt, hash };
}

function verifyPassword(password, salt, expectedHash) {
    try {
        const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
        const expected = Buffer.from(expectedHash, 'hex');
        return hash.length === expected.length && crypto.timingSafeEqual(hash, expected);
    } catch {
        return false;
    }
}

// Basic strength rule shared by create-user and change-password
function passwordProblem(pw) {
    if (typeof pw !== 'string' || pw.length < 6) return 'Password must be at least 6 characters';
    if (pw.length > 200) return 'Password is too long';
    return null;
}

// ------------------------------------------------------------
//  Users
// ------------------------------------------------------------
function createUser({ username, password, fullName = '', role = 'user', mustChange = 0 }) {
    const uname = String(username || '').trim();
    if (!uname) throw new Error('Username is required');
    if (!/^[A-Za-z0-9._@-]{3,40}$/.test(uname)) throw new Error('Username must be 3-40 chars (letters, numbers, . _ @ -)');
    const pwErr = passwordProblem(password);
    if (pwErr) throw new Error(pwErr);
    const exists = db.prepare('SELECT 1 FROM Users WHERE Username = ? COLLATE NOCASE').get(uname);
    if (exists) throw new Error('That username is already taken');
    const { salt, hash } = hashPassword(password);
    const info = db.prepare(`INSERT INTO Users (Username, FullName, PasswordHash, PasswordSalt, Role, Active, MustChangePassword)
        VALUES (?,?,?,?,?,1,?)`).run(uname, String(fullName || ''), hash, salt, role === 'admin' ? 'admin' : 'user', mustChange ? 1 : 0);
    return getUserById(info.lastInsertRowid);
}

function getUserById(id) {
    return db.prepare('SELECT * FROM Users WHERE UserID = ?').get(id);
}
function getUserByName(username) {
    return db.prepare('SELECT * FROM Users WHERE Username = ? COLLATE NOCASE').get(String(username || '').trim());
}

// Strip secret columns before sending a user to the client
function publicUser(u) {
    if (!u) return null;
    return {
        id: u.UserID, username: u.Username, fullName: u.FullName, role: u.Role,
        active: !!u.Active, mustChangePassword: !!u.MustChangePassword,
        createdAt: u.CreatedAt, lastLoginAt: u.LastLoginAt
    };
}

function setPassword(userId, newPassword, { clearMustChange = true } = {}) {
    const pwErr = passwordProblem(newPassword);
    if (pwErr) throw new Error(pwErr);
    const { salt, hash } = hashPassword(newPassword);
    db.prepare(`UPDATE Users SET PasswordHash=?, PasswordSalt=?${clearMustChange ? ', MustChangePassword=0' : ''} WHERE UserID=?`)
        .run(hash, salt, userId);
}

// Create the first administrator if the user table is empty.
function ensureDefaultAdmin() {
    const count = db.prepare('SELECT COUNT(*) c FROM Users').get().c;
    if (count > 0) return null;
    const username = process.env.ADMIN_USER || 'admin';
    const password = process.env.ADMIN_PASS || 'admin123';
    const { salt, hash } = hashPassword(password);
    db.prepare(`INSERT INTO Users (Username, FullName, PasswordHash, PasswordSalt, Role, Active, MustChangePassword)
        VALUES (?,?,?,?, 'admin', 1, 1)`).run(username, 'Administrator', hash, salt);
    console.log(`  Created default admin account  ->  username: "${username}"  password: "${password}"  (change it on first login)`);
    return { username, password };
}

// ------------------------------------------------------------
//  Sessions
// ------------------------------------------------------------
function createSession(userId, userAgent = '') {
    const token = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000).toISOString();
    db.prepare('INSERT INTO Sessions (Token, UserID, ExpiresAt, UserAgent) VALUES (?,?,?,?)')
        .run(token, userId, expires, String(userAgent || '').slice(0, 300));
    return token;
}

function destroySession(token) {
    if (token) db.prepare('DELETE FROM Sessions WHERE Token = ?').run(token);
}

function destroyUserSessions(userId, exceptToken = null) {
    if (exceptToken) db.prepare('DELETE FROM Sessions WHERE UserID = ? AND Token <> ?').run(userId, exceptToken);
    else db.prepare('DELETE FROM Sessions WHERE UserID = ?').run(userId);
}

function userForToken(token) {
    if (!token) return null;
    const row = db.prepare('SELECT * FROM Sessions WHERE Token = ?').get(token);
    if (!row) return null;
    if (new Date(row.ExpiresAt).getTime() < Date.now()) { destroySession(token); return null; }
    const user = getUserById(row.UserID);
    if (!user || !user.Active) return null;
    return user;
}

// Occasionally purge expired sessions
function purgeExpiredSessions() {
    try { db.prepare("DELETE FROM Sessions WHERE ExpiresAt < datetime('now')").run(); } catch {}
}

// ------------------------------------------------------------
//  Cookie helpers
// ------------------------------------------------------------
function parseCookies(req) {
    const header = req.headers.cookie;
    const out = {};
    if (!header) return out;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const k = part.slice(0, idx).trim();
        const v = part.slice(idx + 1).trim();
        if (k) out[k] = decodeURIComponent(v);
    }
    return out;
}

function setSessionCookie(res, token) {
    const maxAge = SESSION_TTL_DAYS * 86400;
    res.append('Set-Cookie',
        `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
}
function clearSessionCookie(res) {
    res.append('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// ------------------------------------------------------------
//  Middleware
// ------------------------------------------------------------
// Attaches req.user (or null) and req.sessionToken for every request.
function attachUser(req, res, next) {
    const token = parseCookies(req)[SESSION_COOKIE];
    req.sessionToken = token || null;
    req.user = token ? userForToken(token) : null;
    next();
}

function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    next();
}

function requireAdmin(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    if (req.user.Role !== 'admin') return res.status(403).json({ error: 'Administrator access required' });
    next();
}

module.exports = {
    SESSION_COOKIE,
    hashPassword, verifyPassword, passwordProblem,
    createUser, getUserById, getUserByName, publicUser, setPassword, ensureDefaultAdmin,
    createSession, destroySession, destroyUserSessions, userForToken, purgeExpiredSessions,
    parseCookies, setSessionCookie, clearSessionCookie,
    attachUser, requireAuth, requireAdmin
};
