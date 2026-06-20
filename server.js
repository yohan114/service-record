// ============================================================
//  Edward & Christie - Fleet Service Record System  (API server)
//  SQLite backend (better-sqlite3). All queries are parameterised.
// ============================================================

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, getSettings, getRates, computeTotals } = require('./db');
const auth = require('./auth');
const xref = require('./xref');

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(auth.attachUser);   // sets req.user / req.sessionToken for every request

// Attachment storage on disk (kept out of git, like the database)
const ATTACH_DIR = path.join(__dirname, 'data', 'attachments');
fs.mkdirSync(ATTACH_DIR, { recursive: true });

// Wrap a synchronous handler with uniform error handling
const h = fn => (req, res) => {
    try { fn(req, res); }
    catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
};

// ------------------------------------------------------------
//  Authentication (these endpoints are intentionally public)
// ------------------------------------------------------------
app.post('/api/auth/login', h((req, res) => {
    const { username, password } = req.body || {};
    const user = auth.getUserByName(username);
    if (!user || !user.Active || !auth.verifyPassword(password, user.PasswordSalt, user.PasswordHash)) {
        return res.status(401).json({ error: 'Invalid username or password' });
    }
    const token = auth.createSession(user.UserID, req.headers['user-agent']);
    auth.setSessionCookie(res, token);
    db.prepare("UPDATE Users SET LastLoginAt = datetime('now') WHERE UserID = ?").run(user.UserID);
    res.json({ success: true, user: auth.publicUser(auth.getUserById(user.UserID)) });
}));

// Returns the current user, or null if not signed in (the SPA uses this to gate)
app.get('/api/auth/me', h((req, res) => {
    res.json({ user: req.user ? auth.publicUser(req.user) : null });
}));

app.post('/api/auth/logout', h((req, res) => {
    auth.destroySession(req.sessionToken);
    auth.clearSessionCookie(res);
    res.json({ success: true });
}));

// ------------------------------------------------------------
//  Everything below /api now requires a valid session
// ------------------------------------------------------------
app.use('/api', auth.requireAuth);

// Change own password (re-checks the current password)
app.post('/api/auth/change-password', h((req, res) => {
    const { currentPassword, newPassword } = req.body || {};
    const user = auth.getUserById(req.user.UserID);
    if (!auth.verifyPassword(currentPassword, user.PasswordSalt, user.PasswordHash)) {
        return res.status(400).json({ error: 'Current password is incorrect' });
    }
    const problem = auth.passwordProblem(newPassword);
    if (problem) return res.status(400).json({ error: problem });
    if (newPassword === currentPassword) return res.status(400).json({ error: 'New password must be different' });
    auth.setPassword(user.UserID, newPassword);
    auth.destroyUserSessions(user.UserID, req.sessionToken);   // sign out other devices
    res.json({ success: true });
}));

// ---- User management (admin only) ----
app.get('/api/users', auth.requireAdmin, h((req, res) => {
    res.json(db.prepare('SELECT * FROM Users ORDER BY Username').all().map(auth.publicUser));
}));
app.post('/api/users', auth.requireAdmin, h((req, res) => {
    const { username, password, fullName, role } = req.body || {};
    const user = auth.createUser({ username, password, fullName, role, mustChange: 1 });
    res.json({ success: true, user: auth.publicUser(user) });
}));
app.put('/api/users/:id', auth.requireAdmin, h((req, res) => {
    const id = Number(req.params.id);
    const target = auth.getUserById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    const { fullName, role, active } = req.body || {};
    // Never allow the last active admin to be demoted / disabled out of existence
    if (target.Role === 'admin' && (role === 'user' || active === false)) {
        const admins = db.prepare("SELECT COUNT(*) c FROM Users WHERE Role='admin' AND Active=1").get().c;
        if (admins <= 1) return res.status(400).json({ error: 'There must be at least one active administrator' });
    }
    db.prepare('UPDATE Users SET FullName=@fn, Role=@role, Active=@active WHERE UserID=@id').run({
        id, fn: fullName != null ? String(fullName) : target.FullName,
        role: role === 'admin' ? 'admin' : (role === 'user' ? 'user' : target.Role),
        active: active === false ? 0 : (active === true ? 1 : target.Active)
    });
    res.json({ success: true, user: auth.publicUser(auth.getUserById(id)) });
}));
app.post('/api/users/:id/reset-password', auth.requireAdmin, h((req, res) => {
    const id = Number(req.params.id);
    if (!auth.getUserById(id)) return res.status(404).json({ error: 'User not found' });
    const { newPassword } = req.body || {};
    auth.setPassword(id, newPassword, { clearMustChange: false });
    db.prepare('UPDATE Users SET MustChangePassword=1 WHERE UserID=?').run(id);
    auth.destroyUserSessions(id);
    res.json({ success: true });
}));
app.delete('/api/users/:id', auth.requireAdmin, h((req, res) => {
    const id = Number(req.params.id);
    if (id === req.user.UserID) return res.status(400).json({ error: 'You cannot delete your own account' });
    const target = auth.getUserById(id);
    if (!target) return res.status(404).json({ error: 'User not found' });
    if (target.Role === 'admin') {
        const admins = db.prepare("SELECT COUNT(*) c FROM Users WHERE Role='admin' AND Active=1").get().c;
        if (admins <= 1) return res.status(400).json({ error: 'There must be at least one active administrator' });
    }
    db.prepare('DELETE FROM Users WHERE UserID = ?').run(id);
    res.json({ success: true });
}));

// ------------------------------------------------------------
//  Catalog (cached in memory — large but static reference data)
// ------------------------------------------------------------
let catalogCache = null;
function buildCatalog() {
    catalogCache = {
        vehicles: db.prepare('SELECT * FROM Vehicles ORDER BY SequenceNo').all(),
        filters:  db.prepare('SELECT * FROM Filters').all(),
        links:    db.prepare('SELECT VehicleFilterID, FilterID, VehicleReference, MatchedECNumber, MatchedVehicleID FROM VehicleFilters').all(),
        prices:   db.prepare('SELECT * FROM FilterPrices').all(),
        oilPrices: db.prepare('SELECT * FROM OilPrices').all(),
        genuine:  db.prepare('SELECT * FROM GenuinePrices').all(),
        motorcycles: db.prepare('SELECT * FROM Motorcycles').all()
    };
    return catalogCache;
}

app.get('/api/catalog', h((req, res) => res.json(catalogCache || buildCatalog())));
app.post('/api/catalog/refresh', h((req, res) => { buildCatalog(); res.json({ success: true }); }));

// ------------------------------------------------------------
//  Settings / rates
// ------------------------------------------------------------
app.get('/api/settings', h((req, res) => {
    res.json({ settings: getSettings(), rates: getRates() });
}));

app.put('/api/settings', auth.requireAdmin, h((req, res) => {
    const upsert = db.prepare('INSERT INTO Settings (Key, Value) VALUES (?, ?) ON CONFLICT(Key) DO UPDATE SET Value=excluded.Value');
    const tx = db.transaction(obj => { for (const [k, v] of Object.entries(obj)) upsert.run(k, String(v)); });
    tx(req.body || {});
    res.json({ success: true, settings: getSettings(), rates: getRates() });
}));

// ------------------------------------------------------------
//  Editable price lists  (Oils / Filter categories / Filter price book)
// ------------------------------------------------------------
function crudList(route, table, idCol, fields, opts = {}) {
    const hasActive = fields.includes('Active');
    const orderBy = fields.includes('SortOrder') ? `SortOrder, ${idCol}` : idCol;
    // GET all, POST add, PUT update, DELETE remove
    app.get(`/api/${route}`, h((req, res) => {
        const where = (hasActive && req.query.all !== '1') ? 'WHERE Active = 1' : '';
        let sql = `SELECT * FROM ${table} ${where} ORDER BY ${orderBy}`;
        if (opts.searchCols && req.query.q) {
            const like = opts.searchCols.map(c => `${c} LIKE @q`).join(' OR ');
            sql = `SELECT * FROM ${table} WHERE (${like}) ${hasActive && req.query.all !== '1' ? 'AND Active = 1' : ''} ORDER BY ${orderBy}`;
            return res.json(db.prepare(sql).all({ q: `%${req.query.q}%` }));
        }
        res.json(db.prepare(sql).all());
    }));
    app.post(`/api/${route}`, h((req, res) => {
        const cols = fields.join(', ');
        const ph = fields.map(f => '@' + f).join(', ');
        const info = db.prepare(`INSERT INTO ${table} (${cols}) VALUES (${ph})`).run(pick(req.body, fields));
        res.json({ success: true, id: info.lastInsertRowid });
    }));
    app.put(`/api/${route}/:id`, h((req, res) => {
        const sets = fields.map(f => `${f}=@${f}`).join(', ');
        db.prepare(`UPDATE ${table} SET ${sets} WHERE ${idCol}=@__id`).run({ ...pick(req.body, fields), __id: req.params.id });
        res.json({ success: true });
    }));
    app.delete(`/api/${route}/:id`, h((req, res) => {
        db.prepare(`DELETE FROM ${table} WHERE ${idCol}=?`).run(req.params.id);
        res.json({ success: true });
    }));
}
function pick(body, fields) {
    const o = {};
    for (const f of fields) {
        let v = body ? body[f] : undefined;
        if (v === undefined || v === null) v = (f === 'Active' ? 1 : (f === 'SortOrder' || f.includes('Price') || f.includes('Qty')) ? 0 : '');
        o[f] = v;
    }
    return o;
}

crudList('oils', 'OilList', 'OilID', ['Name', 'UnitPrice', 'Unit', 'SortOrder', 'Active']);
crudList('filter-categories', 'FilterCategoryList', 'CategoryID', ['Name', 'UnitPrice', 'SortOrder', 'Active']);
crudList('filter-prices', 'FilterPrices', 'PriceID',
    ['SupplierFilterCode', 'Description', 'QuotedQty', 'UnitPriceLKR', 'TotalPriceLKR'],
    { searchCols: ['SupplierFilterCode', 'Description'] });
crudList('oil-prices', 'OilPrices', 'PriceID', ['OilTypeCode', 'Description', 'UnitPriceLKR'], { searchCols: ['OilTypeCode', 'Description'] });

// ------------------------------------------------------------
//  Service records
// ------------------------------------------------------------
const jobSelect = `
    SELECT j.*,
           v.ECNumber, v.Brand, v.VehicleType, v.ModelNo, v.RegistrationNo, v.SequenceNo,
           COALESCE(NULLIF(v.ECNumber,''), j.VehicleLabel, 'Vehicle #' || j.VehicleID) AS DisplayName
    FROM ServiceJobs j LEFT JOIN Vehicles v ON v.VehicleID = j.VehicleID`;

function attachDetails(jobs) {
    if (!jobs.length) return jobs;
    const ids = jobs.map(j => j.ServiceID);
    const ph = ids.map(() => '?').join(',');
    const oils = db.prepare(`SELECT * FROM ServiceOils WHERE ServiceID IN (${ph})`).all(...ids);
    const filters = db.prepare(`SELECT * FROM ServiceFilters WHERE ServiceID IN (${ph})`).all(...ids);
    const costs = db.prepare(`SELECT * FROM ServiceCosts WHERE ServiceID IN (${ph})`).all(...ids);
    const atts = db.prepare(`SELECT AttachmentID, ServiceID, OriginalName, MimeType, FileSize, Caption, UploadedAt
                             FROM ServiceAttachments WHERE ServiceID IN (${ph}) ORDER BY AttachmentID`).all(...ids);
    return jobs.map(j => ({
        ...j,
        oils: oils.filter(o => o.ServiceID === j.ServiceID),
        filters: filters.filter(f => f.ServiceID === j.ServiceID),
        costs: costs.filter(c => c.ServiceID === j.ServiceID),
        attachments: atts.filter(a => a.ServiceID === j.ServiceID)
    }));
}

// Global searchable list (the "anyone can check a record" view)
app.get('/api/services', h((req, res) => {
    const { from, to, vehicleId, site, q } = req.query;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = parseInt(req.query.offset) || 0;
    const cond = [], args = {};
    if (from)      { cond.push('j.ServiceDate >= @from'); args.from = from; }
    if (to)        { cond.push('j.ServiceDate <= @to'); args.to = to; }
    if (vehicleId) { cond.push('j.VehicleID = @vehicleId'); args.vehicleId = vehicleId; }
    if (site)      { cond.push('j.SiteLocation LIKE @site'); args.site = `%${site}%`; }
    if (q)         { cond.push('(j.JobNo LIKE @q OR v.ECNumber LIKE @q OR v.RegistrationNo LIKE @q OR j.VehicleLabel LIKE @q OR v.Brand LIKE @q OR v.ModelNo LIKE @q)'); args.q = `%${q}%`; }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const rows = db.prepare(`${jobSelect} ${where} ORDER BY j.ServiceDate DESC, j.ServiceID DESC LIMIT @limit OFFSET @offset`)
        .all({ ...args, limit, offset });
    const total = db.prepare(`SELECT COUNT(*) c FROM ServiceJobs j LEFT JOIN Vehicles v ON v.VehicleID=j.VehicleID ${where}`).get(args).c;
    res.json({ total, count: rows.length, offset, jobs: attachDetails(rows) });
}));

// Recent (dashboard)
app.get('/api/services/recent', h((req, res) => {
    const rows = db.prepare(`${jobSelect} ORDER BY j.ServiceDate DESC, j.ServiceID DESC LIMIT 50`).all();
    res.json(attachDetails(rows));
}));

// All services on a given day (Daily Log)
app.get('/api/services/by-date/:date', h((req, res) => {
    const rows = db.prepare(`${jobSelect} WHERE j.ServiceDate = ? ORDER BY j.ServiceID DESC`).all(req.params.date);
    res.json(attachDetails(rows));
}));

// Single full job
app.get('/api/services/:id', h((req, res) => {
    const job = db.prepare(`${jobSelect} WHERE j.ServiceID = ?`).get(req.params.id);
    if (!job) return res.status(404).json({ error: 'Not found' });
    res.json(attachDetails([job])[0]);
}));

// Per-vehicle history
app.get('/api/vehicles/:id/history', h((req, res) => {
    const rows = db.prepare(`${jobSelect} WHERE j.VehicleID = ? ORDER BY j.ServiceDate DESC, j.ServiceID DESC`).all(req.params.id);
    res.json(attachDetails(rows));
}));

// ---- Create / update share the same line-item + totals logic ----
function lineItems(data) {
    const oils = (data.oils || []).filter(o => o.name && (o.quantity || o.price || o.action || o.type));
    const filters = (data.filters || []).filter(f => f.category && (f.no || f.price || f.action));
    const costs = (data.costs || []).filter(c => c.desc || c.amount);
    const num = x => Number(x) || 0;
    const partsSubtotal =
        oils.reduce((s, o) => s + num(o.price), 0) +
        filters.reduce((s, f) => s + num(f.price), 0) +
        costs.reduce((s, c) => s + num(c.amount), 0);
    return { oils, filters, costs, totals: computeTotals(partsSubtotal) };
}

function writeChildren(serviceId, oils, filters, costs) {
    const num = x => Number(x) || 0;
    const io = db.prepare('INSERT INTO ServiceOils (ServiceID, OilName, OilType, ActionType, Quantity, Price) VALUES (?,?,?,?,?,?)');
    const iff = db.prepare('INSERT INTO ServiceFilters (ServiceID, FilterCategory, FilterNo, ActionType, Quantity, Price) VALUES (?,?,?,?,?,?)');
    const ic = db.prepare('INSERT INTO ServiceCosts (ServiceID, CostDescription, Unit, Rate, Qty, Amount) VALUES (?,?,?,?,?,?)');
    for (const o of oils) io.run(serviceId, o.name || '', o.type || '', o.action || '', num(o.quantity), num(o.price));
    for (const f of filters) iff.run(serviceId, f.category || '', f.no || '', f.action || '', num(f.quantity || 1), num(f.price));
    for (const c of costs) ic.run(serviceId, c.desc || '', c.unit || '', num(c.rate), num(c.qty), num(c.amount));
}

app.post('/api/services', h((req, res) => {
    const d = req.body;
    if (!d.date) return res.status(400).json({ error: 'Service date is required' });
    const { oils, filters, costs, totals } = lineItems(d);
    const result = db.transaction(() => {
        const info = db.prepare(`INSERT INTO ServiceJobs
            (VehicleID, VehicleLabel, ServiceDate, JobNo, MeterReading, NextServiceMeter, ServiceType,
             SiteLocation, UpkeepingStatus, RepairDetails, PartsSubtotal, LabourRate, LabourCharge,
             SundryRate, SundryAmount, GrandTotal)
            VALUES (@vehicleId,@label,@date,@jobNo,@meter,@nextMeter,@serviceType,@site,@upkeep,@repair,
                    @parts,@lrate,@labour,@srate,@sundry,@grand)`).run({
            vehicleId: d.vehicleId || null, label: d.vehicleLabel || '', date: d.date, jobNo: d.jobNo || '',
            meter: d.meter || '', nextMeter: d.nextMeter || '', serviceType: d.serviceType || '',
            site: d.site || '', upkeep: d.upkeep || '', repair: d.repairDetails || '',
            parts: totals.partsSubtotal, lrate: totals.labourRate, labour: totals.labourCharge,
            srate: totals.sundryRate, sundry: totals.sundryAmount, grand: totals.grandTotal
        });
        const id = info.lastInsertRowid;
        writeChildren(id, oils, filters, costs);
        return id;
    })();
    res.json({ success: true, serviceId: result, totals });
}));

app.put('/api/services/:id', h((req, res) => {
    const id = req.params.id;
    if (!db.prepare('SELECT 1 FROM ServiceJobs WHERE ServiceID=?').get(id)) return res.status(404).json({ error: 'Not found' });
    const d = req.body;
    const { oils, filters, costs, totals } = lineItems(d);
    db.transaction(() => {
        db.prepare(`UPDATE ServiceJobs SET VehicleID=@vehicleId, VehicleLabel=@label, ServiceDate=@date, JobNo=@jobNo,
            MeterReading=@meter, NextServiceMeter=@nextMeter, ServiceType=@serviceType, SiteLocation=@site,
            UpkeepingStatus=@upkeep, RepairDetails=@repair, PartsSubtotal=@parts, LabourRate=@lrate,
            LabourCharge=@labour, SundryRate=@srate, SundryAmount=@sundry, GrandTotal=@grand,
            UpdatedAt=datetime('now') WHERE ServiceID=@id`).run({
            id, vehicleId: d.vehicleId || null, label: d.vehicleLabel || '', date: d.date, jobNo: d.jobNo || '',
            meter: d.meter || '', nextMeter: d.nextMeter || '', serviceType: d.serviceType || '',
            site: d.site || '', upkeep: d.upkeep || '', repair: d.repairDetails || '',
            parts: totals.partsSubtotal, lrate: totals.labourRate, labour: totals.labourCharge,
            srate: totals.sundryRate, sundry: totals.sundryAmount, grand: totals.grandTotal
        });
        db.prepare('DELETE FROM ServiceOils WHERE ServiceID=?').run(id);
        db.prepare('DELETE FROM ServiceFilters WHERE ServiceID=?').run(id);
        db.prepare('DELETE FROM ServiceCosts WHERE ServiceID=?').run(id);
        writeChildren(id, oils, filters, costs);
    })();
    res.json({ success: true, totals });
}));

app.delete('/api/services/:id', h((req, res) => {
    const id = req.params.id;
    db.prepare('DELETE FROM ServiceJobs WHERE ServiceID=?').run(id);   // cascade removes child rows
    // best-effort cleanup of the on-disk attachment folder for this job
    fs.rm(path.join(ATTACH_DIR, String(id)), { recursive: true, force: true }, () => {});
    res.json({ success: true });
}));

// ------------------------------------------------------------
//  Service record attachments  (PDF / JPG / PNG / docs …)
// ------------------------------------------------------------
const ALLOWED_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff',
    'heic', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt']);
const MAX_ATTACH_BYTES = 25 * 1024 * 1024;

function extOf(name) { const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/); return m ? m[1] : ''; }
function safeName(name) { return String(name || 'file').replace(/[\/\\\x00-\x1f]+/g, '_').slice(0, 160) || 'file'; }

app.get('/api/services/:id/attachments', h((req, res) => {
    const rows = db.prepare(`SELECT AttachmentID, ServiceID, OriginalName, MimeType, FileSize, Caption, UploadedAt
                             FROM ServiceAttachments WHERE ServiceID = ? ORDER BY AttachmentID`).all(req.params.id);
    res.json(rows);
}));

// Raw binary upload: the browser POSTs the File directly as the body.
// Filename comes from the X-File-Name header, content-type from Content-Type.
app.post('/api/services/:id/attachments',
    express.raw({ type: () => true, limit: MAX_ATTACH_BYTES }),
    h((req, res) => {
        const serviceId = Number(req.params.id);
        if (!db.prepare('SELECT 1 FROM ServiceJobs WHERE ServiceID = ?').get(serviceId)) {
            return res.status(404).json({ error: 'Service record not found' });
        }
        const original = safeName(decodeURIComponent(req.headers['x-file-name'] || 'file'));
        const ext = extOf(original);
        if (!ALLOWED_EXT.has(ext)) {
            return res.status(400).json({ error: `Unsupported file type ".${ext}". Allowed: ${[...ALLOWED_EXT].join(', ')}` });
        }
        const buf = req.body;
        if (!buf || !buf.length) return res.status(400).json({ error: 'Empty file' });
        if (buf.length > MAX_ATTACH_BYTES) return res.status(413).json({ error: 'File exceeds 25 MB limit' });

        const dir = path.join(ATTACH_DIR, String(serviceId));
        fs.mkdirSync(dir, { recursive: true });
        const stored = `${crypto.randomUUID()}.${ext}`;
        fs.writeFileSync(path.join(dir, stored), buf);

        const caption = safeName(decodeURIComponent(req.headers['x-caption'] || '')).replace(/_/g, ' ').trim();
        const info = db.prepare(`INSERT INTO ServiceAttachments
            (ServiceID, StoredName, OriginalName, MimeType, FileSize, Caption, UploadedBy)
            VALUES (?,?,?,?,?,?,?)`).run(
            serviceId, `${serviceId}/${stored}`, original,
            req.headers['content-type'] || 'application/octet-stream', buf.length,
            caption.slice(0, 200), req.user.UserID);

        res.json({ success: true, attachment: db.prepare('SELECT AttachmentID, ServiceID, OriginalName, MimeType, FileSize, Caption, UploadedAt FROM ServiceAttachments WHERE AttachmentID = ?').get(info.lastInsertRowid) });
    }));

// Stream a file (inline preview by default, ?dl=1 forces download)
app.get('/api/attachments/:attId/file', h((req, res) => {
    const a = db.prepare('SELECT * FROM ServiceAttachments WHERE AttachmentID = ?').get(req.params.attId);
    if (!a) return res.status(404).json({ error: 'Not found' });
    const filePath = path.join(ATTACH_DIR, a.StoredName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });
    res.setHeader('Content-Type', a.MimeType || 'application/octet-stream');
    const disp = req.query.dl ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disp}; filename="${encodeURIComponent(a.OriginalName)}"`);
    fs.createReadStream(filePath).pipe(res);
}));

app.delete('/api/attachments/:attId', h((req, res) => {
    const a = db.prepare('SELECT * FROM ServiceAttachments WHERE AttachmentID = ?').get(req.params.attId);
    if (!a) return res.status(404).json({ error: 'Not found' });
    db.prepare('DELETE FROM ServiceAttachments WHERE AttachmentID = ?').run(a.AttachmentID);
    fs.rm(path.join(ATTACH_DIR, a.StoredName), { force: true }, () => {});
    res.json({ success: true });
}));

// ------------------------------------------------------------
//  Filter cross-reference engine  (type any part no -> equivalents)
// ------------------------------------------------------------
app.get('/api/xref/search', h((req, res) => {
    res.json(xref.search(req.query.q || '', { limit: Math.min(parseInt(req.query.limit) || 25, 100) }));
}));

app.get('/api/xref/stats', h((req, res) => res.json(xref.indexStats())));

app.get('/api/xref/filter/:id', h((req, res) => {
    const out = xref.describeFilter(Number(req.params.id));
    if (!out) return res.status(404).json({ error: 'Filter not found' });
    res.json(out);
}));

// Browse the full filter database (paginated, searchable across every field + index)
app.get('/api/filters', h((req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = parseInt(req.query.offset) || 0;
    const q = (req.query.q || '').trim();
    const cat = (req.query.category || '').trim();
    const cond = [], args = {};
    if (cat) { cond.push('f.FilterCategory = @cat'); args.cat = cat; }
    if (q) {
        const nq = xref.normalize(q);
        cond.push(`(f.OEMPartNumber LIKE @like OR f.HIFIPartNumber LIKE @like OR f.Description LIKE @like
                    OR f.FilterCategory LIKE @like OR f.CrossReferences LIKE @like
                    OR f.FilterID IN (SELECT FilterID FROM FilterCrossRefs WHERE NormalizedPN LIKE @nlike))`);
        args.like = `%${q}%`; args.nlike = `%${nq}%`;
    }
    const where = cond.length ? 'WHERE ' + cond.join(' AND ') : '';
    const rows = db.prepare(`SELECT f.*,
            (SELECT COUNT(*) FROM FilterCrossRefs x WHERE x.FilterID = f.FilterID) AS RefCount
         FROM Filters f ${where} ORDER BY f.FilterCategory, f.FilterID LIMIT @limit OFFSET @offset`)
        .all({ ...args, limit, offset });
    const total = db.prepare(`SELECT COUNT(*) c FROM Filters f ${where}`).get(args).c;
    const categories = db.prepare("SELECT DISTINCT FilterCategory cat FROM Filters WHERE FilterCategory <> '' ORDER BY cat").all().map(r => r.cat);
    res.json({ total, count: rows.length, offset, categories, filters: rows });
}));

// Add a manual cross-reference to a filter (any signed-in user can enrich the DB)
app.post('/api/filters/:id/xref', h((req, res) => {
    const { brand, partNumber, note } = req.body || {};
    const idNum = xref.addManualRef({ filterId: Number(req.params.id), brand, partNumber, note });
    res.json({ success: true, xrefId: idNum, filter: xref.describeFilter(Number(req.params.id)) });
}));

app.delete('/api/xref/:xrefId', h((req, res) => {
    xref.deleteManualRef(Number(req.params.xrefId));
    res.json({ success: true });
}));

// Rebuild the auto index from the Filters catalog (admin)
app.post('/api/xref/rebuild', auth.requireAdmin, h((req, res) => {
    res.json({ success: true, ...xref.rebuildIndex() });
}));

// All filters (with cross-references) used by one of OUR fleet vehicles
app.get('/api/vehicles/:id/filters', h((req, res) => {
    const v = db.prepare(`SELECT VehicleID, EquipmentDescription, ECNumber, Brand, ModelNo,
                                 VehicleType, RegistrationNo, Site
                          FROM Vehicles WHERE VehicleID = ?`).get(req.params.id);
    if (!v) return res.status(404).json({ error: 'Vehicle not found' });
    res.json({ vehicle: v, filters: xref.filtersForVehicle(Number(req.params.id)) });
}));

// ------------------------------------------------------------
//  Dashboard stats
// ------------------------------------------------------------
app.get('/api/stats', h((req, res) => {
    const vehicles = db.prepare('SELECT COUNT(*) c FROM Vehicles').get().c;
    const filters = db.prepare('SELECT COUNT(*) c FROM Filters').get().c;
    const services = db.prepare('SELECT COUNT(*) c FROM ServiceJobs').get().c;
    const thisMonth = db.prepare("SELECT COUNT(*) c FROM ServiceJobs WHERE strftime('%Y-%m', ServiceDate) = strftime('%Y-%m','now')").get().c;
    // monthly counts grouped by year (mirrors the old "Service summery" sheet)
    const monthly = db.prepare(`
        SELECT strftime('%Y', ServiceDate) yr, strftime('%m', ServiceDate) mo, COUNT(*) c
        FROM ServiceJobs WHERE ServiceDate IS NOT NULL AND ServiceDate <> ''
        GROUP BY yr, mo ORDER BY yr, mo`).all();
    res.json({ vehicles, filters, services, thisMonth, monthly });
}));

// ------------------------------------------------------------
//  Vehicles CRUD
// ------------------------------------------------------------
app.post('/api/vehicles', h((req, res) => {
    const d = req.body;
    const seqRow = db.prepare('SELECT MAX(SequenceNo) maxSeq FROM Vehicles').get();
    const nextSeq = (seqRow ? (seqRow.maxSeq || 0) : 0) + 1;

    const info = db.prepare(`INSERT INTO Vehicles
        (SequenceNo, EquipmentDescription, ECNumber, Brand, VehicleType, ModelNo, RegistrationNo,
         Capacity, YearOfManufacture, SerialNo, ChassisNo, EngineNo, GPSUnit, Site, Status)
        VALUES (@seq,@desc,@ec,@brand,@type,@model,@reg,@cap,@year,@serial,@chassis,@engine,@gps,@site,@status)`).run({
        seq: d.SequenceNo || nextSeq,
        desc: d.EquipmentDescription || '',
        ec: d.ECNumber || '',
        brand: d.Brand || '',
        type: d.VehicleType || '',
        model: d.ModelNo || '',
        reg: d.RegistrationNo || '',
        cap: d.Capacity || '',
        year: d.YearOfManufacture || '',
        serial: d.SerialNo || '',
        chassis: d.ChassisNo || '',
        engine: d.EngineNo || '',
        gps: d.GPSUnit || '',
        site: d.Site || '',
        status: d.Status || 'Active'
    });

    const newId = info.lastInsertRowid;
    buildCatalog(); // rebuild mem cache

    const vehicle = db.prepare('SELECT * FROM Vehicles WHERE VehicleID = ?').get(newId);
    res.json({ success: true, vehicle });
}));

app.put('/api/vehicles/:id', h((req, res) => {
    const id = req.params.id;
    const d = req.body;

    db.prepare(`UPDATE Vehicles SET
        EquipmentDescription=@desc, ECNumber=@ec, Brand=@brand, VehicleType=@type, ModelNo=@model, RegistrationNo=@reg,
        Capacity=@cap, YearOfManufacture=@year, SerialNo=@serial, ChassisNo=@chassis, EngineNo=@engine, GPSUnit=@gps,
        Site=@site, Status=@status WHERE VehicleID=@id`).run({
        id,
        desc: d.EquipmentDescription || '',
        ec: d.ECNumber || '',
        brand: d.Brand || '',
        type: d.VehicleType || '',
        model: d.ModelNo || '',
        reg: d.RegistrationNo || '',
        cap: d.Capacity || '',
        year: d.YearOfManufacture || '',
        serial: d.SerialNo || '',
        chassis: d.ChassisNo || '',
        engine: d.EngineNo || '',
        gps: d.GPSUnit || '',
        site: d.Site || '',
        status: d.Status || 'Active'
    });

    buildCatalog(); // rebuild mem cache
    res.json({ success: true });
}));

app.delete('/api/vehicles/:id', h((req, res) => {
    const id = req.params.id;

    // Prevent deletion if the vehicle is linked to service jobs
    const count = db.prepare('SELECT COUNT(*) c FROM ServiceJobs WHERE VehicleID = ?').get(id).c;
    if (count > 0) {
        return res.status(400).json({ error: `Cannot delete vehicle. It has ${count} service record(s) linked to it.` });
    }

    db.prepare('DELETE FROM Vehicles WHERE VehicleID = ?').run(id);
    buildCatalog(); // rebuild mem cache
    res.json({ success: true });
}));

// Clean JSON 404 for any unmatched API route (makes "wrong origin" mistakes obvious)
app.use('/api', (req, res) => res.status(404).json({ error: `Unknown API route: ${req.method} ${req.path}` }));

// SPA fallback for client-side hash routing
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ------------------------------------------------------------
//  Boot: catalog cache, default admin, cross-reference index
// ------------------------------------------------------------
buildCatalog();
auth.ensureDefaultAdmin();
auth.purgeExpiredSessions();
try {
    const r = xref.ensureIndex();
    if (!r.skipped) console.log(`  Cross-reference index built: ${r.indexed} entries from ${r.filters} filters`);
} catch (e) { console.error('Cross-reference index error:', e.message); }

const PORT = process.env.PORT || 2300;
app.listen(PORT, () => console.log(`Service Record System running on http://localhost:${PORT}`));
