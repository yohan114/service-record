const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const dbPath = 'd:/Yohan/service record system/data/service.db';
if (!fs.existsSync(dbPath)) {
    console.error('Database not found:', dbPath);
    process.exit(1);
}

const db = new DatabaseSync(dbPath);

const filterPrices = db.prepare('SELECT * FROM FilterPrices').all();
const filters = db.prepare('SELECT * FROM Filters').all();

console.log(`Loaded ${filterPrices.length} prices and ${filters.length} filters from database.`);

// Stop words to filter out brand names and generic words
const stopWords = new Set([
    'VIC', 'JAPAN', 'KOMTEN', 'FLEETGUARD', 'TATA', 'JCB', 'JASON', 'HIGH', 'OSC', 'OSK', 
    'SANRA', 'SARA', 'AUGUST', 'MAN', 'DUT', 'CYPAK', 'XENON', 'KUBOTA', 'LEYPACK', 
    'LEYPARTS', 'PERKINS', 'BOBCAT', 'JESON', 'IVECO', 'HIGHHI', 'KFC', 'VOLVO', 'BOSCH', 
    'INDIAN', 'GENUINE', 'SAKURA', 'JS', 'SET', 'OUTER', 'INNER', 'FILTER', 'OIL', 'FUEL', 
    'AIR', 'SEPARATOR', 'ELEMENT', 'TYPO', 'PARTS', 'EQUIVALENT', 'TO', 'NONE', 'IDENTIFIED',
    'REFER', 'ORIGINAL', 'PART', 'CASING'
]);

function normalize(s) {
    return (s || '').toString().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cleanAndExtractCodes(text) {
    if (!text) return [];
    
    const blacklistWords = [
        'COMPATIBLE', 'CHANGED', 'SENT', 'FROM', 'PLACEHOLDER', 'REPLACES', 'EQUIVALENT',
        'DIESEL', 'ENGINE', 'LUBE', 'PRIMARY', 'SAFETY', 'INNER', 'OUTER', 'FILTER', 'WATER',
        'SEPARATOR', 'OIL', 'FUEL', 'TRANSMISSION', 'GEAR', 'AXLE', 'UNIT', 'PRICE', 'LKR',
        'TOTAL', 'QTY', 'TBD', '🔍', 'ASSY', 'CHANGED', 'BADA', 'GAMA', 'SPEC', 'COMPATIB', 'PART',
        'ORIGINAL', 'CASING', 'REFER', 'IDENTIFIED', 'NONE', 'JAPAN', 'VIC', 'TOYOTA', 'FORD', 'MITSUBISHI',
        'KOMTEN', 'FLEETGUARD', 'TATA', 'JCB', 'JASON', 'HIGH', 'OSC', 'OSK', 
        'SANRA', 'SARA', 'AUGUST', 'MAN', 'DUT', 'CYPAK', 'XENON', 'KUBOTA', 'LEYPACK', 
        'LEYPARTS', 'PERKINS', 'BOBCAT', 'JESON', 'IVECO', 'HIGHHI', 'KFC', 'VOLVO', 'BOSCH', 
        'INDIAN', 'GENUINE', 'SAKURA', 'JS', 'SET'
    ];
    
    const cleanText = text.replace(/[^A-Z0-9-\/]/gi, ' ');
    const parts = cleanText.split(/\s+/);
    const results = [];
    
    parts.forEach(p => {
        const token = p.trim().toUpperCase();
        if (token.length > 2 && token.length <= 15 &&
            !stopWords.has(token) && 
            !blacklistWords.some(w => token.includes(w)) &&
            /\d/.test(token) && 
            /^[A-Z0-9-\/]+$/.test(token)) {
            results.push(p.trim());
            const rawAlphanum = token.replace(/[^A-Z0-9]/g, '');
            if (rawAlphanum.length > 2 && rawAlphanum.length <= 15 && !stopWords.has(rawAlphanum) && !blacklistWords.some(w => rawAlphanum.includes(w))) {
                results.push(rawAlphanum);
            }
        }
    });
    return [...new Set(results)].filter(c => c.length > 1);
}

// Map of normalized filter code -> price row
const priceMap = new Map();
filterPrices.forEach(p => {
    const rawCode = p.SupplierFilterCode || '';
    const normCode = normalize(rawCode);
    if (normCode) {
        priceMap.set(normCode, p);
    }
    const codes = cleanAndExtractCodes(rawCode);
    codes.forEach(c => {
        const nc = normalize(c);
        if (nc && !priceMap.has(nc)) {
            priceMap.set(nc, p);
        }
    });
});

// Find cross references for each price row
const priceIdToCrossRefs = new Map(); // PriceID -> Set of equivalent codes

filters.forEach(f => {
    const oem = f.OEMPartNumber || '';
    const hifi = f.HIFIPartNumber || '';
    const cross = f.CrossReferences || '';
    
    const normOem = normalize(oem);
    const normHifi = normalize(hifi);
    
    // Find if this filter matches any price
    let matchedPrice = null;
    if (normOem && priceMap.has(normOem)) matchedPrice = priceMap.get(normOem);
    else if (normHifi && priceMap.has(normHifi)) matchedPrice = priceMap.get(normHifi);
    else {
        const crossCodes = cleanAndExtractCodes(cross);
        for (const c of crossCodes) {
            const nc = normalize(c);
            if (priceMap.has(nc)) {
                matchedPrice = priceMap.get(nc);
                break;
            }
        }
    }
    
    if (matchedPrice) {
        let codesSet = priceIdToCrossRefs.get(matchedPrice.PriceID);
        if (!codesSet) {
            codesSet = new Set();
            priceIdToCrossRefs.set(matchedPrice.PriceID, codesSet);
        }
        
        const oemCodes = cleanAndExtractCodes(oem);
        const hifiCodes = cleanAndExtractCodes(hifi);
        const crossCodes = cleanAndExtractCodes(cross);
        
        oemCodes.forEach(c => {
            if (normalize(c) !== normalize(matchedPrice.SupplierFilterCode)) {
                codesSet.add(c);
            }
        });
        hifiCodes.forEach(c => {
            if (normalize(c) !== normalize(matchedPrice.SupplierFilterCode)) {
                codesSet.add(c);
            }
        });
        crossCodes.forEach(c => {
            if (normalize(c) !== normalize(matchedPrice.SupplierFilterCode)) {
                codesSet.add(c);
            }
        });
    }
});

// Prepare updates
const newEntries = [];
for (const p of filterPrices) {
    const refs = priceIdToCrossRefs.get(p.PriceID);
    if (refs && refs.size > 0) {
        refs.forEach(ref => {
            const normRef = normalize(ref);
            const existing = priceMap.get(normRef);
            if (existing && existing.PriceID !== p.PriceID) {
                return; // skip conflicts
            }
            newEntries.push({
                code: ref,
                description: `${p.Description} (Equiv. to ${p.SupplierFilterCode})`,
                qty: p.QuotedQty,
                unit: p.UnitPriceLKR,
                total: p.TotalPriceLKR
            });
        });
    }
}

console.log(`Prepared ${newEntries.length} new entries to insert.`);

// Idempotent insertion query
const insertStmt = db.prepare(`
    INSERT INTO FilterPrices (SupplierFilterCode, Description, QuotedQty, UnitPriceLKR, TotalPriceLKR)
    SELECT @code, @description, @qty, @unit, @total
    WHERE NOT EXISTS (
        SELECT 1 FROM FilterPrices WHERE UPPER(TRIM(SupplierFilterCode)) = UPPER(TRIM(@code))
    )
`);

let insertedCount = 0;
db.exec('BEGIN TRANSACTION');
try {
    newEntries.forEach(entry => {
        const info = insertStmt.run(entry);
        if (info.changes > 0) {
            insertedCount++;
        }
    });
    db.exec('COMMIT');
    console.log(`Successfully inserted ${insertedCount} new cross-reference price entries into the database.`);
} catch (e) {
    db.exec('ROLLBACK');
    console.error('Error during database update:', e);
    process.exit(1);
}
