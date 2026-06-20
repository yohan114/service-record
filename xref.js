// ============================================================
//  Filter cross-reference engine
//  ------------------------------------------------------------
//  Turns every filter's OEM number, HIFI number and free-text
//  "cross reference" string into a normalised, searchable index
//  (the FilterCrossRefs table). You can then type ANY part number
//  — from any brand — and get back the matching filter(s) together
//  with their full set of equivalents, the vehicles that use them,
//  and a price estimate.
//
//  The parser is deliberately forgiving: the part-number token is
//  the primary signal (anything alphanumeric containing a digit),
//  so even when a brand name is missing the equivalence is still
//  captured. Brands are detected best-effort for nicer display.
// ============================================================

const { db } = require('./db');

// Known filter / OEM brands (best-effort labelling only).
const BRANDS_1 = new Set([
    'sakura', 'vic', 'fleetguard', 'baldwin', 'donaldson', 'mann', 'mahle', 'bosch', 'wix',
    'ryco', 'hengst', 'racor', 'hifi', 'jcb', 'toyota', 'mico', 'tata', 'komatsu', 'fram',
    'purolator', 'kubota', 'perkins', 'caterpillar', 'cat', 'volvo', 'hitachi', 'hyundai',
    'doosan', 'isuzu', 'mitsubishi', 'nissan', 'denso', 'napa', 'parker', 'deutz', 'cummins',
    'yanmar', 'jason', 'jeson', 'leypack', 'leyparts', 'kfc', 'osc', 'osk', 'sanra', 'sara',
    'august', 'cypak', 'xenon', 'iveco', 'bobcat', 'js', 'ufi', 'sofima', 'tecfil', 'asas',
    'kolbenschmidt', 'filtron', 'wesfil', 'ashika', 'blueprint', 'febi', 'champion', 'crosland'
]);
const BRANDS_2 = new Set([
    'ashok leyland', 'sf filter', 'mico bosch', 'mann hummel', 'mann filter', 'donaldson blue',
    'ec genuine', 'genuine parts', 'fleet guard'
]);

const clean = t => (t || '').replace(/[(),.;:]+$/g, '').replace(/^[(),.;:]+/g, '').trim();
const lower = t => clean(t).toLowerCase();

// Normalised key used for matching (uppercase, alphanumeric only).
function normalize(s) {
    return (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

// Does a token look like a part number? (has a digit, >= 3 useful chars)
function isPartNumber(token) {
    const t = clean(token);
    if (!/[0-9]/.test(t)) return false;                 // must contain a digit
    if (!/^[A-Za-z0-9][A-Za-z0-9\-\/.]*$/.test(t)) return false;
    if (normalize(t).length < 3) return false;
    if (/^(19|20)\d{2}$/.test(t)) return false;         // bare year, ignore
    return true;
}

const SEPARATORS = new Set(['/', '\\', '&', '-', 'or', 'and', 'to', 'equivalent', 'eq', 'aka',
    'series', 'type', 'genuine', 'standard', 'set', 'kit', 'replaces', 'replacement', 'ref']);

// Parse a free-text cross-reference string into {brand, partNumber} pairs.
function parseCrossRefText(text) {
    if (!text) return [];
    const tokens = String(text).split(/[\s,]+/).filter(Boolean);
    const out = [];
    let currentBrand = '';
    for (let i = 0; i < tokens.length; i++) {
        const oneRaw = clean(tokens[i]);
        if (!oneRaw) continue;
        const one = lower(tokens[i]);
        const two = i + 1 < tokens.length ? `${one} ${lower(tokens[i + 1])}` : null;

        if (two && BRANDS_2.has(two)) { currentBrand = titleBrand(two); i++; continue; }
        if (BRANDS_1.has(one)) { currentBrand = titleBrand(one); continue; }

        if (isPartNumber(oneRaw)) {
            out.push({ brand: currentBrand, partNumber: oneRaw });
            continue;
        }
        // plain descriptive word (fuel, filter, element…) or separator: keep brand context
        if (!SEPARATORS.has(one) && one.length > 2 && !/[0-9]/.test(one)) {
            // a non-brand descriptive word does not change the brand
        }
    }
    return dedupePairs(out);
}

function titleBrand(b) {
    return b.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function dedupePairs(pairs) {
    const seen = new Set();
    const out = [];
    for (const p of pairs) {
        const key = normalize(p.partNumber);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        out.push(p);
    }
    return out;
}

// ------------------------------------------------------------
//  Build / rebuild the auto part of the index from Filters.
//  Manual rows (Source='manual') are preserved.
// ------------------------------------------------------------
function rebuildIndex() {
    const filters = db.prepare('SELECT FilterID, FilterCategory, OEMPartNumber, HIFIPartNumber, Description, CrossReferences FROM Filters').all();
    const ins = db.prepare(`INSERT INTO FilterCrossRefs (FilterID, Brand, PartNumber, NormalizedPN, RefType, Source)
        VALUES (@fid,@brand,@pn,@npn,@type,'auto')`);

    const run = db.transaction(() => {
        db.prepare("DELETE FROM FilterCrossRefs WHERE Source = 'auto'").run();
        let count = 0;
        for (const f of filters) {
            const seen = new Set();
            const push = (pn, brand, type) => {
                const npn = normalize(pn);
                if (!npn || npn.length < 3) return;
                const key = npn + '|' + type;
                if (seen.has(key)) return;
                seen.add(key);
                ins.run({ fid: f.FilterID, brand: brand || '', pn: clean(pn), npn, type });
                count++;
            };
            if (f.OEMPartNumber)  push(f.OEMPartNumber, '', 'oem');
            if (f.HIFIPartNumber) push(f.HIFIPartNumber, 'HIFI', 'hifi');
            for (const p of parseCrossRefText(f.CrossReferences)) push(p.partNumber, p.brand, 'cross');
        }
        return count;
    });
    const n = run();
    return { filters: filters.length, indexed: n };
}

function indexStats() {
    const total = db.prepare('SELECT COUNT(*) c FROM FilterCrossRefs').get().c;
    const manual = db.prepare("SELECT COUNT(*) c FROM FilterCrossRefs WHERE Source='manual'").get().c;
    const filters = db.prepare('SELECT COUNT(*) c FROM Filters').get().c;
    const withRefs = db.prepare('SELECT COUNT(DISTINCT FilterID) c FROM FilterCrossRefs').get().c;
    return { totalCrossRefs: total, manualCrossRefs: manual, filters, filtersWithRefs: withRefs };
}

// Build the index on boot if it is empty but filters exist.
function ensureIndex() {
    const has = db.prepare('SELECT COUNT(*) c FROM FilterCrossRefs').get().c;
    const filters = db.prepare('SELECT COUNT(*) c FROM Filters').get().c;
    if (has === 0 && filters > 0) return rebuildIndex();
    return { skipped: true, ...indexStats() };
}

// ------------------------------------------------------------
//  Build a rich result object for one filter (equivalents,
//  vehicles, price). Used by the search endpoint.
// ------------------------------------------------------------
function describeFilter(filterId, matchedPN = '') {
    const f = db.prepare('SELECT * FROM Filters WHERE FilterID = ?').get(filterId);
    if (!f) return null;

    const refs = db.prepare('SELECT Brand, PartNumber, NormalizedPN, RefType, Source FROM FilterCrossRefs WHERE FilterID = ? ORDER BY (RefType=\'oem\') DESC, (RefType=\'hifi\') DESC, Brand').all(filterId);

    // group equivalents by brand for display
    const groups = {};
    for (const r of refs) {
        const label = r.RefType === 'oem' ? 'OEM' : (r.Brand || (r.RefType === 'hifi' ? 'HIFI' : 'Other'));
        (groups[label] = groups[label] || []).push({ partNumber: r.PartNumber, type: r.RefType, source: r.Source });
    }

    // vehicles that use this filter
    const vehicles = db.prepare(`
        SELECT v.VehicleID, v.ECNumber, v.Brand, v.ModelNo, v.VehicleType, v.RegistrationNo
        FROM VehicleFilters vf JOIN Vehicles v ON v.VehicleID = vf.MatchedVehicleID
        WHERE vf.FilterID = ? AND vf.MatchedVehicleID IS NOT NULL
        GROUP BY v.VehicleID ORDER BY v.SequenceNo LIMIT 60`).all(filterId);

    // best-effort price: any equivalent part number found in the price book
    let price = null;
    const norms = refs.map(r => r.NormalizedPN).filter(Boolean);
    if (norms.length) {
        const priceRows = db.prepare('SELECT SupplierFilterCode, Description, UnitPriceLKR, TotalPriceLKR FROM FilterPrices').all();
        for (const pr of priceRows) {
            const code = normalize(pr.SupplierFilterCode);
            if (code && norms.includes(code)) {
                price = { code: pr.SupplierFilterCode, description: pr.Description, unit: pr.UnitPriceLKR || pr.TotalPriceLKR || 0 };
                break;
            }
        }
    }

    return {
        filterId: f.FilterID,
        category: f.FilterCategory,
        description: f.Description,
        oem: f.OEMPartNumber,
        hifi: f.HIFIPartNumber,
        crossText: f.CrossReferences,
        matchedPN,
        equivalents: groups,
        equivalentCount: refs.length,
        vehicles,
        vehicleCount: vehicles.length,
        price
    };
}

// ------------------------------------------------------------
//  Search: type any filter / part number -> matching filters.
// ------------------------------------------------------------
function search(q, { limit = 25 } = {}) {
    const nq = normalize(q);
    if (nq.length < 2) return { query: q, normalized: nq, count: 0, results: [], note: 'Type at least 2 characters.' };

    // 1) exact, 2) prefix, 3) contains — collect distinct FilterIDs preserving rank
    const exact  = db.prepare('SELECT DISTINCT FilterID, PartNumber FROM FilterCrossRefs WHERE NormalizedPN = ? LIMIT 200').all(nq);
    const prefix = db.prepare('SELECT DISTINCT FilterID, PartNumber FROM FilterCrossRefs WHERE NormalizedPN LIKE ? AND NormalizedPN <> ? LIMIT 200').all(nq + '%', nq);
    const contains = nq.length >= 3
        ? db.prepare('SELECT DISTINCT FilterID, PartNumber FROM FilterCrossRefs WHERE NormalizedPN LIKE ? AND NormalizedPN NOT LIKE ? LIMIT 200').all('%' + nq + '%', nq + '%')
        : [];

    const order = [];
    const matchedPN = new Map();
    for (const row of [...exact, ...prefix, ...contains]) {
        if (row.FilterID == null) continue;
        if (!matchedPN.has(row.FilterID)) { matchedPN.set(row.FilterID, row.PartNumber); order.push(row.FilterID); }
    }

    const results = order.slice(0, limit).map(fid => describeFilter(fid, matchedPN.get(fid))).filter(Boolean);
    return {
        query: q,
        normalized: nq,
        count: order.length,
        shown: results.length,
        exactMatches: exact.length,
        results
    };
}

// Manual cross-reference management ---------------------------
function addManualRef({ filterId, brand = '', partNumber, note = '' }) {
    const pn = clean(partNumber);
    const npn = normalize(pn);
    if (!npn || npn.length < 2) throw new Error('A valid part number is required');
    if (filterId == null) throw new Error('A filter is required');
    if (!db.prepare('SELECT 1 FROM Filters WHERE FilterID = ?').get(filterId)) throw new Error('Filter not found');
    const dup = db.prepare('SELECT 1 FROM FilterCrossRefs WHERE FilterID = ? AND NormalizedPN = ?').get(filterId, npn);
    if (dup) throw new Error('That cross-reference already exists for this filter');
    const info = db.prepare(`INSERT INTO FilterCrossRefs (FilterID, Brand, PartNumber, NormalizedPN, RefType, Note, Source)
        VALUES (?,?,?,?, 'manual', ?, 'manual')`).run(filterId, String(brand || ''), pn, npn, String(note || ''));
    return info.lastInsertRowid;
}

function deleteManualRef(xrefId) {
    const row = db.prepare('SELECT Source FROM FilterCrossRefs WHERE XRefID = ?').get(xrefId);
    if (!row) throw new Error('Cross-reference not found');
    if (row.Source !== 'manual') throw new Error('Only manually-added cross-references can be deleted');
    db.prepare('DELETE FROM FilterCrossRefs WHERE XRefID = ?').run(xrefId);
}

// All filters used by one fleet vehicle, each with its full equivalence set.
function filtersForVehicle(vehicleId) {
    const fids = db.prepare(
        `SELECT DISTINCT FilterID FROM VehicleFilters
         WHERE MatchedVehicleID = ? AND FilterID IS NOT NULL`).all(vehicleId).map(r => r.FilterID);
    return fids.map(id => describeFilter(id)).filter(Boolean);
}

module.exports = {
    normalize, parseCrossRefText, isPartNumber,
    rebuildIndex, ensureIndex, indexStats, describeFilter,
    search, addManualRef, deleteManualRef, filtersForVehicle
};
