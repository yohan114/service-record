// ============================================================
//  Filter Cross-Reference view
//  - Type any part number -> matching filters + all equivalents
//  - Browse the full filter database
//  - Add manual cross-references to grow the knowledge base
// ============================================================
let xrefTimer = null;
let xrefInited = false;
const EXAMPLES = ['FF5045', 'P550410', 'FC-1001', '320/04134', 'BF7535', 'LF3874'];

const xnorm = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');

async function initXrefView() {
    if (!xrefInited) {
        xrefInited = true;
        document.getElementById('xref-examples').innerHTML =
            'Try: ' + EXAMPLES.map(e => `<button class="xref-chip" onclick="xrefExample('${e}')">${e}</button>`).join(' ');
        loadXrefStats();
        loadFilterCategories();
    }
    const input = document.getElementById('xrefInput');
    if (input.value.trim()) runXrefSearch();
    setTimeout(() => input.focus(), 60);
}

async function loadXrefStats() {
    try {
        const s = await api('/api/xref/stats');
        document.getElementById('xref-stats').innerHTML = `
            <div class="xref-stat"><b>${s.filters.toLocaleString()}</b> filters</div>
            <div class="xref-stat"><b>${s.totalCrossRefs.toLocaleString()}</b> cross-references</div>
            <div class="xref-stat"><b>${s.manualCrossRefs.toLocaleString()}</b> added by you</div>`;
    } catch (e) { /* non-fatal */ }
}

function xrefExample(v) { document.getElementById('xrefInput').value = v; runXrefSearch(); }
function debounceXref() { clearTimeout(xrefTimer); xrefTimer = setTimeout(runXrefSearch, 280); }

async function runXrefSearch() {
    const q = document.getElementById('xrefInput').value.trim();
    const box = document.getElementById('xref-results');
    switchXrefTab('search');
    if (q.length < 2) { box.innerHTML = '<div class="empty-note">Enter a filter number above to check its cross-references.</div>'; return; }
    box.innerHTML = '<div class="loading">Searching…</div>';
    try {
        const data = await api('/api/xref/search?q=' + encodeURIComponent(q));
        if (!data.results.length) {
            box.innerHTML = `<div class="empty-note">No filter found for “${esc(q)}”.
                <div class="muted small" style="margin-top:8px">It may not be in the catalog yet. Open the <a href="#" onclick="switchXrefTab('db');return false;">Filter Database</a> to browse, or add it as a cross-reference to an existing filter.</div></div>`;
            return;
        }
        const head = `<div class="xref-result-head">Found <b>${data.count}</b> matching filter${data.count === 1 ? '' : 's'} for “${esc(q)}”${data.shown < data.count ? ` · showing first ${data.shown}` : ''}</div>`;
        box.innerHTML = head + data.results.map(r => renderXrefCard(r, q)).join('');
    } catch (e) {
        box.innerHTML = '<div class="empty-note err">Error: ' + esc(e.message) + '</div>';
    }
}

function renderXrefCard(r, query) {
    const nq = xnorm(query || r.matchedPN);
    const brands = Object.keys(r.equivalents);
    const equivHtml = brands.map(b => {
        const chips = r.equivalents[b].map(p => {
            const hit = xnorm(p.partNumber) === nq ? ' hit' : '';
            const manual = p.source === 'manual' ? ' manual' : '';
            return `<span class="xref-pn${hit}${manual}" title="${p.source === 'manual' ? 'Added manually' : p.type.toUpperCase()}">${esc(p.partNumber)}</span>`;
        }).join('');
        return `<div class="xref-brand-row"><span class="xref-brand-name">${esc(b)}</span><span class="xref-pn-set">${chips}</span></div>`;
    }).join('');

    const veh = r.vehicles.slice(0, 8).map(v =>
        `<span class="xref-veh" title="${esc(v.Brand || '')} ${esc(v.ModelNo || '')}">${esc(v.ECNumber || v.RegistrationNo || ('#' + v.VehicleID))}</span>`).join('');
    const moreVeh = r.vehicleCount > 8 ? `<span class="muted small"> +${r.vehicleCount - 8} more</span>` : '';

    return `
    <div class="xref-card">
        <div class="xref-card-head">
            <div class="xref-card-title">
                <span class="xref-cat">${esc(r.category || 'Filter')}</span>
                <h3>${esc(r.description || r.matchedPN || ('Filter #' + r.filterId))}</h3>
                <div class="xref-ids">
                    ${r.oem ? `<span><em>OEM</em> ${esc(r.oem)}</span>` : ''}
                    ${r.hifi ? `<span><em>HIFI</em> ${esc(r.hifi)}</span>` : ''}
                    <span><em>Equivalents</em> ${r.equivalentCount}</span>
                </div>
            </div>
            <div class="xref-card-actions">
                ${r.price ? `<div class="xref-price" title="${esc(r.price.code || '')}">${fmtMoney(r.price.unit)}</div>` : ''}
                <button class="btn btn-mini btn-secondary" onclick="openAddXref(${r.filterId}, '${esc((r.oem || r.matchedPN || '').replace(/'/g, ''))}')">+ Add equivalent</button>
            </div>
        </div>
        <div class="xref-equivs">${equivHtml || '<span class="muted small">No equivalents recorded yet — add one.</span>'}</div>
        ${r.vehicleCount ? `<div class="xref-vehicles"><span class="muted small">Used by ${r.vehicleCount} machine${r.vehicleCount === 1 ? '' : 's'}:</span> ${veh}${moreVeh}</div>` : ''}
    </div>`;
}

function switchXrefTab(tab) {
    document.querySelectorAll('.xref-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.xtab === tab));
    document.getElementById('xref-search-panel').style.display = tab === 'search' ? 'block' : 'none';
    document.getElementById('xref-db-panel').style.display = tab === 'db' ? 'block' : 'none';
    if (tab === 'db' && !fdbLoaded) loadFilterDb();
}

// ---------------- Add a manual cross-reference ----------------
let addXrefFilterId = null;
function openAddXref(filterId, forLabel) {
    addXrefFilterId = filterId;
    document.getElementById('addXrefForm').reset();
    document.getElementById('ax-err').textContent = '';
    document.getElementById('ax-for').innerHTML = `Adding an equivalent part number to filter <b>${esc(forLabel || ('#' + filterId))}</b>. It becomes instantly searchable.`;
    openModal('addXrefModal');
    setTimeout(() => document.getElementById('ax-part').focus(), 60);
}

async function submitAddXref(e) {
    e.preventDefault();
    const brand = document.getElementById('ax-brand').value.trim();
    const partNumber = document.getElementById('ax-part').value.trim();
    const note = document.getElementById('ax-note').value.trim();
    const err = document.getElementById('ax-err');
    err.textContent = '';
    try {
        await api('/api/filters/' + addXrefFilterId + '/xref', 'POST', { brand, partNumber, note });
        toast('Cross-reference added');
        closeModal('addXrefModal');
        loadXrefStats();
        if (document.getElementById('xrefInput').value.trim()) runXrefSearch();
        if (fdbLoaded) loadFilterDb();
    } catch (e2) { err.textContent = e2.message; }
}

// ---------------- Filter database browse ----------------
let fdbOffset = 0, fdbTotal = 0, fdbLoaded = false, fdbTimer = null;

async function loadFilterCategories() {
    try {
        const data = await api('/api/filters?limit=1');
        const sel = document.getElementById('fdbCategory');
        sel.innerHTML = '<option value="">All categories</option>' +
            (data.categories || []).map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    } catch (e) { /* non-fatal */ }
}

function debounceFdb() { clearTimeout(fdbTimer); fdbTimer = setTimeout(loadFilterDb, 280); }

function fdbQuery(offset) {
    const p = new URLSearchParams();
    const q = document.getElementById('fdbSearch').value.trim();
    const cat = document.getElementById('fdbCategory').value;
    if (q) p.set('q', q);
    if (cat) p.set('category', cat);
    p.set('limit', 50); p.set('offset', offset);
    return '/api/filters?' + p.toString();
}

async function loadFilterDb() {
    fdbLoaded = true;
    const list = document.getElementById('fdb-list');
    list.innerHTML = '<div class="loading">Loading…</div>';
    try {
        const data = await api(fdbQuery(0));
        fdbTotal = data.total; fdbOffset = data.filters.length;
        document.getElementById('fdbCount').textContent = `${data.total.toLocaleString()} filter${data.total === 1 ? '' : 's'}`;
        list.innerHTML = data.filters.length ? data.filters.map(fdbRow).join('')
            : '<div class="empty-note">No matching filters.</div>';
        document.getElementById('fdbMoreBtn').style.display = fdbOffset < fdbTotal ? 'inline-block' : 'none';
    } catch (e) { list.innerHTML = '<div class="empty-note err">Error: ' + esc(e.message) + '</div>'; }
}

async function loadMoreFilterDb() {
    try {
        const data = await api(fdbQuery(fdbOffset));
        document.getElementById('fdb-list').insertAdjacentHTML('beforeend', data.filters.map(fdbRow).join(''));
        fdbOffset += data.filters.length;
        document.getElementById('fdbMoreBtn').style.display = fdbOffset < fdbTotal ? 'inline-block' : 'none';
    } catch (e) { toast('Error: ' + e.message, 'err'); }
}

function fdbRow(f) {
    return `
    <div class="fdb-row" onclick="checkFilter(${f.FilterID})" title="Check cross-references">
        <div class="fdb-cat">${esc(f.FilterCategory || '—')}</div>
        <div class="fdb-main">
            <div class="fdb-codes">
                ${f.OEMPartNumber ? `<b>${esc(f.OEMPartNumber)}</b>` : '<span class="muted">no OEM no.</span>'}
                ${f.HIFIPartNumber ? `<span class="fdb-hifi">HIFI ${esc(f.HIFIPartNumber)}</span>` : ''}
            </div>
            <div class="fdb-desc">${esc(f.Description || '')}</div>
        </div>
        <div class="fdb-refcount">${f.RefCount} ref${f.RefCount === 1 ? '' : 's'}</div>
    </div>`;
}

// Open a filter's full cross-reference card from the database list
async function checkFilter(filterId) {
    switchXrefTab('search');
    const box = document.getElementById('xref-results');
    box.innerHTML = '<div class="loading">Loading…</div>';
    try {
        const r = await api('/api/xref/filter/' + filterId);
        document.getElementById('xrefInput').value = r.oem || r.hifi || '';
        box.innerHTML = `<div class="xref-result-head">Cross-references for <b>${esc(r.oem || r.description || ('#' + filterId))}</b></div>` + renderXrefCard(r, r.oem || '');
    } catch (e) { box.innerHTML = '<div class="empty-note err">Error: ' + esc(e.message) + '</div>'; }
}
