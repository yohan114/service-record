// ============================================================
//  App shell: global data, settings/rates, hash router, helpers
// ============================================================

let globalData = {
    vehicles: [], filters: [], links: [], prices: [], oilPrices: [], genuine: [],
    brands: new Set(), types: new Set(),
    vehicleById: new Map(),
    rates: { labourRateLow: 20, labourRateHigh: 15, labourThreshold: 10000, sundryRate: 5 },
    settings: { currency: 'Rs' }
};

const ROUTES = {
    '#/dashboard': { view: 'dashboard', init: () => loadDashboard() },
    '#/daily':     { view: 'daily',     init: () => initDailyView() },
    '#/records':   { view: 'records',   init: () => initRecordsView() },
    '#/fleet':     { view: 'fleet',     init: () => performSearch() },
    '#/xref':      { view: 'xref',      init: () => initXrefView() },
    '#/prices':    { view: 'prices',    init: () => initPriceLists() },
    '#/users':     { view: 'users',     init: () => loadUsers() },
    '#/settings':  { view: 'settings',  init: () => loadSettingsView() }
};

function handleRoute() {
    const hash = window.location.hash || '#/dashboard';
    const route = ROUTES[hash] || ROUTES['#/dashboard'];
    // Guard admin-only routes for non-admin users
    if (route.view === 'users' && !isAdmin()) { location.hash = '#/dashboard'; return; }
    document.querySelectorAll('.view').forEach(v => v.style.display = 'none');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    document.getElementById('view-' + route.view).style.display = 'block';
    const navEl = document.getElementById('nav-' + route.view);
    if (navEl) navEl.classList.add('active');
    
    // Close sidebar on mobile navigation
    toggleSidebar(false);
    
    try { route.init(); } catch (e) { console.error(e); }
}

function toggleSidebar(show) {
    const sidebar = document.querySelector('.sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar && overlay) {
        if (show === undefined) {
            sidebar.classList.toggle('open');
            overlay.classList.toggle('visible');
        } else if (show) {
            sidebar.classList.add('open');
            overlay.classList.add('visible');
        } else {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        }
    }
}
window.addEventListener('hashchange', handleRoute);

// Step 1: check who is signed in. If nobody, show the login screen and stop.
async function initApp() {
    try {
        const me = await fetch('/api/auth/me').then(r => r.json());
        if (!me.user) { showLogin(); return; }
        currentUser = me.user;
        await onAuthenticated();
    } catch (err) {
        console.error('Auth check failed:', err);
        showLogin(`Could not reach the server. Is it running? (${esc(err.message)})`);
    }
}

// Step 2: runs after a successful sign-in (on page load or via the login form).
async function onAuthenticated() {
    renderAccount(currentUser);
    await loadAppData();
    if (currentUser.mustChangePassword) openChangePassword(true);
}

// Step 3: load the reference catalog + settings the rest of the app needs.
async function loadAppData() {
    try {
        const [catRes, setRes] = await Promise.all([fetch('/api/catalog'), fetch('/api/settings')]);
        const db = await catRes.json();
        const s = await setRes.json();

        globalData.vehicles = db.vehicles || [];
        globalData.filters  = db.filters || [];
        globalData.links    = db.links || [];
        globalData.prices   = db.prices || [];
        globalData.oilPrices = db.oilPrices || [];
        globalData.genuine  = db.genuine || [];
        globalData.rates    = s.rates || globalData.rates;
        globalData.settings = s.settings || globalData.settings;

        globalData.brands.clear(); globalData.types.clear(); globalData.vehicleById.clear();
        globalData.vehicles.forEach(v => {
            globalData.vehicleById.set(String(v.VehicleID), v);
            if (v.VehicleType) globalData.types.add(v.VehicleType.trim().toUpperCase());
            if (v.Brand) globalData.brands.add(v.Brand.trim().toUpperCase());
        });

        if (typeof initFleetView === 'function') initFleetView();
        handleRoute();
    } catch (err) {
        console.error('Error loading data:', err);
        document.body.insertAdjacentHTML('afterbegin',
            `<div style="background:#7f1d1d;color:#fff;padding:12px;text-align:center">Failed to load data from the server. (${esc(err.message)})</div>`);
    }
}

// ---------- shared helpers ----------
function fmtMoney(num) {
    const n = Number(num) || 0;
    return (globalData.settings.currency || 'Rs') + ' ' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDate(d) {
    if (!d) return '-';
    const dt = new Date(d);
    return isNaN(dt) ? d : dt.toLocaleDateString('en-GB');
}
function vehicleLabel(v) {
    if (!v) return '';
    return `${v.ECNumber || ''}${v.ECNumber ? ' · ' : ''}${v.Brand || ''} ${v.ModelNo || v.VehicleType || ''}`.trim();
}
// Client mirror of the server money math (for live preview)
function computeTotals(parts) {
    const r = globalData.rates;
    parts = Math.round((Number(parts) || 0) * 100) / 100;
    const labourRate = parts > r.labourThreshold ? r.labourRateHigh : r.labourRateLow;
    const labourCharge = Math.round(parts * labourRate) / 100;
    const sundryAmount = Math.round(parts * r.sundryRate) / 100;
    return { partsSubtotal: parts, labourRate, labourCharge, sundryRate: r.sundryRate, sundryAmount,
             grandTotal: Math.round((parts + labourCharge + sundryAmount) * 100) / 100 };
}
function esc(s) {
    return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function closeModal(id) { document.getElementById(id).classList.remove('visible'); }
function openModal(id) { document.getElementById(id).classList.add('visible'); }

async function refreshCatalog() {
    try {
        const catRes = await fetch('/api/catalog');
        const db = await catRes.json();
        
        globalData.vehicles = db.vehicles || [];
        globalData.filters  = db.filters || [];
        globalData.links    = db.links || [];
        globalData.prices   = db.prices || [];
        globalData.oilPrices = db.oilPrices || [];
        globalData.genuine  = db.genuine || [];

        globalData.brands.clear();
        globalData.types.clear();
        globalData.vehicleById.clear();

        globalData.vehicles.forEach(v => {
            globalData.vehicleById.set(String(v.VehicleID), v);
            if (v.VehicleType) globalData.types.add(v.VehicleType.trim().toUpperCase());
            if (v.Brand) globalData.brands.add(v.Brand.trim().toUpperCase());
        });

        if (typeof populateFilterDropdowns === 'function') {
            populateFilterDropdowns();
        }
    } catch (err) {
        console.error('Error refreshing catalog:', err);
    }
}

let toastTimer = null;
function toast(msg, type = 'ok') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.className = 'toast', 2600);
}

async function api(url, method = 'GET', body) {
    const opt = { method, headers: { 'Content-Type': 'application/json' } };
    if (body !== undefined) opt.body = JSON.stringify(body);
    const res = await fetch(url, opt);
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && !url.includes('/api/auth/login')) {
        // Session expired or missing — bounce back to the login screen
        if (typeof showLogin === 'function') { currentUser = null; showLogin('Your session expired. Please sign in again.'); }
        throw new Error(data.error || 'Authentication required');
    }
    if (!res.ok) throw new Error(data.error || ('HTTP ' + res.status));
    return data;
}

document.addEventListener('DOMContentLoaded', initApp);
