const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const db = new DatabaseSync('d:/Yohan/service record system/data/service.db');

const filterPrices = db.prepare('SELECT * FROM FilterPrices').all();
const filters = db.prepare('SELECT * FROM Filters').all();

console.log(`Loaded ${filterPrices.length} prices and ${filters.length} filters.`);

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

console.log(`Mapped ${priceMap.size} unique keys from existing prices.`);

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

// Print matches summary
let totalNewEntries = 0;
const newEntriesList = [];

for (const p of filterPrices) {
    const refs = priceIdToCrossRefs.get(p.PriceID);
    if (refs && refs.size > 0) {
        console.log(`\nPrice Row [${p.PriceID}] "${p.SupplierFilterCode}" (Rs. ${p.UnitPriceLKR}):`);
        console.log(`  Cross References:`, [...refs]);
        refs.forEach(ref => {
            // Check if this ref already matches another existing price directly to avoid conflicts
            const normRef = normalize(ref);
            const existing = priceMap.get(normRef);
            if (existing && existing.PriceID !== p.PriceID) {
                console.log(`    (Skipped conflict: "${ref}" already exists in price row [${existing.PriceID}] "${existing.SupplierFilterCode}")`);
                return;
            }
            newEntriesList.push({
                SupplierFilterCode: ref,
                Description: `${p.Description} (Equiv. to ${p.SupplierFilterCode})`,
                QuotedQty: p.QuotedQty,
                UnitPriceLKR: p.UnitPriceLKR,
                TotalPriceLKR: p.TotalPriceLKR,
                ParentCode: p.SupplierFilterCode
            });
            totalNewEntries++;
        });
    }
}

console.log(`\nTotal new cross-reference price entries to add: ${totalNewEntries}`);
console.log(`Sample new entries:`, newEntriesList.slice(0, 10));
