const XLSX = require('xlsx');
const path = require('path');
const { db } = require('../db');

const excelFile = path.join('d:', 'Yohan', 'service record system', 'Service record.xlsx');
try {
    const workbook = XLSX.readFile(excelFile);
    const targetSheetName = workbook.SheetNames.find(s => s.toLowerCase() === 'summary' || s.toLowerCase() === 'summery');
    const worksheet = workbook.Sheets[targetSheetName];
    const excelRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' });
    
    // Normalise helper
    const norm = s => (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
    const parseHistDate = v => {
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
    };

    // Build vehicle maps
    const ecMap = new Map(), regMap = new Map();
    for (const v of db.prepare('SELECT VehicleID, ECNumber, RegistrationNo FROM Vehicles').all()) {
        if (v.ECNumber) ecMap.set(norm(v.ECNumber), v.VehicleID);
        if (v.RegistrationNo) regMap.set(norm(v.RegistrationNo), v.VehicleID);
    }
    const matchVehicle = raw => {
        const tokens = new Set();
        tokens.add(norm(raw));
        for (const t of (raw || '').split(/[(),/\s]+/)) if (t && t.length >= 2) tokens.add(norm(t));
        for (const t of tokens) { if (regMap.has(t)) return regMap.get(t); }
        for (const t of tokens) { if (ecMap.has(t)) return ecMap.get(t); }
        return null;
    };

    // Load all DB jobs to memory
    const dbJobs = db.prepare("SELECT ServiceID, VehicleID, VehicleLabel, ServiceDate, JobNo, MeterReading FROM ServiceJobs").all();
    
    // We will build a key for each DB job
    // Key format: "VehicleID:VehicleLabel:Date:MeterReading"
    const dbKeys = new Set();
    dbJobs.forEach(j => {
        const key = `${j.VehicleID || ''}|${norm(j.VehicleLabel)}|${j.ServiceDate || ''}|${norm(j.MeterReading)}`;
        dbKeys.add(key);
    });

    const COLS = ['date', 'jobNo', 'vehicleRaw', 'site', 'sm', 'nsm', 'oilQty', 'oilFilter',
                  'fuel1', 'fuel2', 'lineFilter', 'airInner', 'airOuter', 'gearTrans', 'hyFilter', 'remarks'];

    let countFoundInDB = 0;
    let countNew = 0;
    let newRecordsSample = [];

    for (let i = 1; i < excelRows.length; i++) {
        const r = excelRows[i]; if (!r) continue;
        const rec = {};
        COLS.forEach((k, j) => rec[k] = r[j] == null ? '' : String(r[j]).trim());
        if (!rec.vehicleRaw) continue;
        const isoDate = parseHistDate(r[0]);
        const vid = matchVehicle(rec.vehicleRaw);
        
        // Generate key using matched VehicleID or vehicleRaw
        const key = `${vid || ''}|${norm(rec.vehicleRaw)}|${isoDate || ''}|${norm(rec.sm)}`;
        
        if (dbKeys.has(key)) {
            countFoundInDB++;
        } else {
            countNew++;
            if (newRecordsSample.length < 5) {
                newRecordsSample.push({ index: i, rec, key });
            }
        }
    }

    console.log("Total spreadsheet rows checked:", excelRows.length - 1);
    console.log("Found in DB:", countFoundInDB);
    console.log("New records not in DB:", countNew);
    console.log("Sample new records:", JSON.stringify(newRecordsSample, null, 2));

} catch (err) {
    console.error("Error during check:", err.message);
}
