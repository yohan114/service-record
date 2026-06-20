// ============================================================
//  Step-by-step Excel Service Record Importer
//  Reads "Service record.xlsx" (Summery sheet), checks if records
//  already exist in the SQLite database, and imports new ones
//  one by one, computing prices and totals.
// ============================================================

const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { db, computeTotals } = require('./db');

// Locate Excel file
let excelPath = path.join(__dirname, 'Service record.xlsx');
if (!fs.existsSync(excelPath)) {
    excelPath = path.join('d:', 'Yohan', 'Service record', 'Service record.xlsx');
}

if (!fs.existsSync(excelPath)) {
    console.error(`Error: Excel file not found at ${excelPath}`);
    process.exit(1);
}

console.log(`Loading Excel file from: ${excelPath}`);

// Helper to normalize strings for comparison
const norm = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');

// Parse dates into YYYY-MM-DD format
function parseHistDate(v) {
    if (v == null || v === '') return null;
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    const s = String(v).trim();
    const m = s.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})$/);
    if (m) {
        let y = +m[3]; if (y < 100) y += 2000;
        const dt = new Date(Date.UTC(y, +m[2] - 1, +m[1]));
        return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
    }
    const dt = new Date(s);
    return isNaN(dt) ? null : dt.toISOString().slice(0, 10);
}

// ------------------------------------------------------------
//  1. Build Vehicle Mapping Lookup
// ------------------------------------------------------------
const ecMap = new Map();
const regMap = new Map();
for (const v of db.prepare('SELECT VehicleID, ECNumber, RegistrationNo FROM Vehicles').all()) {
    if (v.ECNumber) ecMap.set(norm(v.ECNumber), v.VehicleID);
    if (v.RegistrationNo) regMap.set(norm(v.RegistrationNo), v.VehicleID);
}

const matchVehicle = raw => {
    if (!raw) return null;
    const tokens = new Set();
    tokens.add(norm(raw));
    for (const t of (raw || '').split(/[(),/\s]+/)) {
        if (t && t.length >= 2) tokens.add(norm(t));
    }
    for (const t of tokens) {
        if (regMap.has(t)) return regMap.get(t);
    }
    for (const t of tokens) {
        if (ecMap.has(t)) return ecMap.get(t);
    }
    return null;
};

// ------------------------------------------------------------
//  2. Build Filter Price Book (from UI / service_form.js logic)
// ------------------------------------------------------------
const filterPriceMap = new Map();
const stopWords = new Set([
    'VIC', 'JAPAN', 'KOMTEN', 'FLEETGUARD', 'TATA', 'JCB', 'JASON', 'HIGH', 'OSC', 'OSK', 
    'SANRA', 'SARA', 'AUGUST', 'MAN', 'DUT', 'CYPAK', 'XENON', 'KUBOTA', 'LEYPACK', 
    'LEYPARTS', 'PERKINS', 'BOBCAT', 'JESON', 'IVECO', 'HIGHHI', 'KFC', 'VOLVO', 'BOSCH', 
    'INDIAN', 'GENUINE', 'SAKURA', 'JS', 'SET', 'OUTER', 'INNER', 'FILTER', 'OIL', 'FUEL', 
    'AIR', 'SEPARATOR', 'ELEMENT', 'TYPO', 'PARTS', 'EQUIVALENT', 'TO'
]);

const extractCodes = text => {
    if (!text) return [];
    const parts = text.replace(/[^A-Z0-9-\/]/gi, ' ').split(/\s+/);
    const codes = [];
    parts.forEach(p => {
        const clean = p.trim();
        if (clean.length > 2 && !stopWords.has(clean.toUpperCase())) {
            codes.push(clean);
            codes.push(clean.replace(/[^A-Z0-9]/gi, ''));
        }
    });
    return codes.filter(c => c.length > 1);
};

// Load prices from database
const filterPrices = db.prepare('SELECT * FROM FilterPrices').all();
const filters = db.prepare('SELECT * FROM Filters').all();

filterPrices.forEach(p => {
    const rawCode = p.SupplierFilterCode || '';
    const price = p.UnitPriceLKR || p.TotalPriceLKR || 0;
    if (!price) return;
    filterPriceMap.set(rawCode.toUpperCase().trim(), price);
    filterPriceMap.set(norm(rawCode), price);
    const extracted = extractCodes(rawCode);
    extracted.forEach(c => filterPriceMap.set(c.toUpperCase(), price));
});

filters.forEach(f => {
    const oem = f.OEMPartNumber || '';
    const hifi = f.HIFIPartNumber || '';
    const cross = f.CrossReferences || '';
    const normOem = norm(oem);
    const normHifi = norm(hifi);
    let price = null;
    if (normOem && filterPriceMap.has(normOem)) price = filterPriceMap.get(normOem);
    else if (normHifi && filterPriceMap.has(normHifi)) price = filterPriceMap.get(normHifi);
    else {
        const crossCodes = extractCodes(cross);
        for (const c of crossCodes) {
            const normC = norm(c);
            if (filterPriceMap.has(normC)) {
                price = filterPriceMap.get(normC);
                break;
            }
        }
    }
    if (price) {
        if (oem) {
            filterPriceMap.set(oem.toUpperCase().trim(), price);
            filterPriceMap.set(normOem, price);
        }
        if (hifi) {
            filterPriceMap.set(hifi.toUpperCase().trim(), price);
            filterPriceMap.set(normHifi, price);
        }
        const crossCodes = extractCodes(cross);
        crossCodes.forEach(c => {
            const key = c.toUpperCase();
            const normC = norm(c);
            if (!filterPriceMap.has(key)) filterPriceMap.set(key, price);
            if (!filterPriceMap.has(normC)) filterPriceMap.set(normC, price);
        });
    }
});

function lookupFilterPrice(no) {
    if (!no) return 0;
    const key = no.toUpperCase().trim();
    if (filterPriceMap.has(key)) return filterPriceMap.get(key);
    const normKey = key.replace(/[^A-Z0-9]/g, '');
    if (filterPriceMap.has(normKey)) return filterPriceMap.get(normKey);
    for (const [code, price] of filterPriceMap.entries()) {
        if (code.includes(key) || key.includes(code)) return price;
        if (normKey && code.includes(normKey)) return price;
    }
    return 0;
}

// ------------------------------------------------------------
//  3. Build Oil Price Lookup
// ------------------------------------------------------------
// Default Engine Oil is 15W40-CI/04, price is 1475.00
const ENGINE_OIL_PRICE_LKR = 1475.00;

// ------------------------------------------------------------
//  4. Load Existing DB Records (Deduplication Map)
// ------------------------------------------------------------
const dbJobs = db.prepare("SELECT ServiceID, VehicleID, VehicleLabel, ServiceDate, MeterReading, JobNo FROM ServiceJobs").all();
const dbKeys = new Set();
const dbJobNos = new Set();

dbJobs.forEach(j => {
    // Key format: "VehicleID|NormalizedVehicleLabel|ServiceDate|NormalizedMeterReading"
    const key = `${j.VehicleID || ''}|${norm(j.VehicleLabel)}|${j.ServiceDate || ''}|${norm(j.MeterReading)}`;
    dbKeys.add(key);
    if (j.JobNo) {
        dbJobNos.add(j.JobNo.trim().toUpperCase());
    }
});

console.log(`Loaded ${dbJobs.length} existing service jobs from database.`);

// ------------------------------------------------------------
//  5. Read Excel Worksheet
// ------------------------------------------------------------
const workbook = XLSX.readFile(excelPath);
const targetSheetName = workbook.SheetNames.find(s => s.toLowerCase() === 'summary' || s.toLowerCase() === 'summery');
if (!targetSheetName) {
    console.error("Error: Could not find Summary/Summery sheet in the Excel file.");
    process.exit(1);
}

const worksheet = workbook.Sheets[targetSheetName];
const excelRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });

console.log(`Found sheet '${targetSheetName}' with ${excelRows.length} total rows.`);

// Column mapping based on seed.js
const COLS = ['date', 'jobNo', 'vehicleRaw', 'site', 'sm', 'nsm', 'oilQty', 'oilFilter',
              'fuel1', 'fuel2', 'lineFilter', 'airInner', 'airOuter', 'gearTrans', 'hyFilter', 'remarks'];

const FILTER_MAP = [
    ['oilFilter', 'Engine Oil Filter'], ['fuel1', 'Primary Fuel Filter'], ['fuel2', 'Water Separator'],
    ['lineFilter', 'Line Filter'], ['airInner', 'Air Filter Inner'], ['airOuter', 'Air Filter Outer'],
    ['gearTrans', 'Trans: Filter'], ['hyFilter', 'Hydraulic Filter - S']
];

// Pre-compiled prepared statements for insertion
const insJob = db.prepare(`INSERT INTO ServiceJobs
    (VehicleID, VehicleLabel, ServiceDate, JobNo, MeterReading, NextServiceMeter, SiteLocation, RepairDetails)
    VALUES (@vid,@label,@date,@job,@sm,@nsm,@site,@remarks)`);

const insFilt = db.prepare(`INSERT INTO ServiceFilters (ServiceID, FilterCategory, FilterNo, ActionType, Quantity, Price)
    VALUES (?,?,?,?,1,?)`);

const insOil = db.prepare(`INSERT INTO ServiceOils (ServiceID, OilName, OilType, ActionType, Quantity, Price)
    VALUES (?, 'Engine Oil', '15W40-CI/04', 'c', ?, ?)`);

const updJobTotals = db.prepare(`UPDATE ServiceJobs SET
    PartsSubtotal = @parts, LabourRate = @lrate, LabourCharge = @labour,
    SundryRate = @srate, SundryAmount = @sundry, GrandTotal = @grand
    WHERE ServiceID = @id`);

let countTotal = 0;
let countSkipped = 0;
let countImported = 0;
let countErrors = 0;

console.log("\nStarting step-by-step import...\n");

for (let i = 1; i < excelRows.length; i++) {
    const r = excelRows[i];
    if (!r || r.length === 0) continue;
    
    const rec = {};
    COLS.forEach((k, j) => rec[k] = r[j] == null ? '' : String(r[j]).trim());
    
    if (!rec.vehicleRaw) {
        continue; // Skip empty rows
    }
    
    countTotal++;
    
    const isoDate = parseHistDate(r[0]);
    const vid = matchVehicle(rec.vehicleRaw);
    
    // Generate unique composite key
    const key = `${vid || ''}|${norm(rec.vehicleRaw)}|${isoDate || ''}|${norm(rec.sm)}`;
    
    // Check if duplicate
    const isDuplicateByKey = dbKeys.has(key);
    const isDuplicateByJobNo = rec.jobNo && dbJobNos.has(rec.jobNo.toUpperCase());
    
    if (isDuplicateByKey || isDuplicateByJobNo) {
        countSkipped++;
        // Quietly skip duplicate records or print occasionally to prevent output floods
        if (countSkipped % 200 === 0) {
            console.log(`... Skipped ${countSkipped} duplicates so far ...`);
        }
        continue;
    }
    
    // Import record step by step
    try {
        db.transaction(() => {
            // 1. Insert ServiceJob
            const jobInfo = insJob.run({
                vid,
                label: rec.vehicleRaw,
                date: isoDate,
                job: rec.jobNo,
                sm: rec.sm,
                nsm: rec.nsm,
                site: rec.site,
                remarks: rec.remarks
            });
            const serviceId = jobInfo.lastInsertRowid;
            
            let partsSubtotal = 0;
            
            // 2. Insert Filters
            for (const [keyName, catName] of FILTER_MAP) {
                const filterNo = rec[keyName];
                if (filterNo) {
                    const price = lookupFilterPrice(filterNo);
                    insFilt.run(serviceId, catName, filterNo, 'X', price);
                    partsSubtotal += price;
                }
            }
            
            // 3. Insert Oil
            const oilQty = parseFloat(rec.oilQty.replace(/[^0-9.]/g, ''));
            if (oilQty) {
                const price = Math.round(oilQty * ENGINE_OIL_PRICE_LKR * 100) / 100;
                insOil.run(serviceId, oilQty, price);
                partsSubtotal += price;
            }
            
            // 4. Compute and Update Totals
            const totals = computeTotals(partsSubtotal);
            updJobTotals.run({
                parts: totals.partsSubtotal,
                lrate: totals.labourRate,
                labour: totals.labourCharge,
                srate: totals.sundryRate,
                sundry: totals.sundryAmount,
                grand: totals.grandTotal,
                id: serviceId
            });
            
            countImported++;
            console.log(`[IMPORT] Added Service #${serviceId} | Date: ${isoDate || 'N/A'} | Vehicle: ${rec.vehicleRaw} (matched to ID: ${vid || 'None'}) | Job: ${rec.jobNo || 'None'} | Meter: ${rec.sm || 'None'} | Grand Total: LKR ${totals.grandTotal}`);
        })();
    } catch (err) {
        countErrors++;
        console.error(`[ERROR] Failed to import row ${i} for vehicle ${rec.vehicleRaw}:`, err.message);
    }
}

console.log("\n=============================================");
console.log("             IMPORT COMPLETED                ");
console.log("=============================================");
console.log(`Total checked spreadsheet rows: ${countTotal}`);
console.log(`Duplicates skipped:            ${countSkipped}`);
console.log(`Successfully imported:         ${countImported}`);
console.log(`Errors encountered:            ${countErrors}`);
console.log("=============================================");
