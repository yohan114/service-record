// ============================================================
//  SQLite data layer for the Service Record System
//  Replaces the previous Windows-only MS Access (node-adodb) backend.
//  - Opens (and creates) data/service.db
//  - Builds the full schema if it does not exist
//  - Seeds default Settings, Oil list and Filter category list
// ============================================================

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'service.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// better-sqlite3 compatibility wrapper for transactions
db.transaction = function(fn) {
    return function(...args) {
        db.exec('BEGIN');
        try {
            const result = fn(...args);
            db.exec('COMMIT');
            return result;
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    };
};

// ------------------------------------------------------------
//  Schema
// ------------------------------------------------------------
db.exec(`
-- ============ Reference catalog (seeded from vehicle_filter_data.js) ============
CREATE TABLE IF NOT EXISTS Vehicles (
    VehicleID            INTEGER PRIMARY KEY,
    SequenceNo           INTEGER,
    EquipmentDescription TEXT,
    ECNumber             TEXT,
    Brand                TEXT,
    VehicleType          TEXT,
    ModelNo              TEXT,
    RegistrationNo       TEXT,
    Capacity             TEXT,
    YearOfManufacture    TEXT,
    SerialNo             TEXT,
    ChassisNo            TEXT,
    EngineNo             TEXT,
    GPSUnit              TEXT,
    Site                 TEXT,
    Status               TEXT DEFAULT 'Active'
);
CREATE INDEX IF NOT EXISTS idx_Vehicles_EC  ON Vehicles (ECNumber);
CREATE INDEX IF NOT EXISTS idx_Vehicles_Reg ON Vehicles (RegistrationNo);

CREATE TABLE IF NOT EXISTS Filters (
    FilterID             INTEGER PRIMARY KEY,
    AnalysisRank         INTEGER,
    FilterCategory       TEXT,
    OEMPartNumber        TEXT,
    HIFIPartNumber       TEXT,
    Description          TEXT,
    TotalServiceCount    INTEGER,
    UniqueVehicleCount   INTEGER,
    TopVehicleMatch      TEXT,
    MonthlyDemand        REAL,
    AnnualDemand         REAL,
    CompatibleFleetTypes TEXT,
    CrossReferences      TEXT
);
CREATE INDEX IF NOT EXISTS idx_Filters_Cat ON Filters (FilterCategory);

CREATE TABLE IF NOT EXISTS VehicleFilters (
    VehicleFilterID  INTEGER PRIMARY KEY AUTOINCREMENT,
    FilterID         INTEGER,
    VehicleReference TEXT,
    MatchedECNumber  TEXT,
    MatchedVehicleID INTEGER
);
CREATE INDEX IF NOT EXISTS idx_VF_Vehicle ON VehicleFilters (MatchedVehicleID);
CREATE INDEX IF NOT EXISTS idx_VF_Filter  ON VehicleFilters (FilterID);

CREATE TABLE IF NOT EXISTS GenuinePrices (
    GenuinePriceID      INTEGER PRIMARY KEY,
    HIFIEquivalent      TEXT,
    GenuineBrand        TEXT,
    RetailPriceExclVAT  REAL,
    VATAmount           REAL,
    SourcingPriceInclVAT REAL
);

CREATE TABLE IF NOT EXISTS Motorcycles (
    MotorcycleID   INTEGER PRIMARY KEY,
    ECNumber       TEXT,
    Brand          TEXT,
    VehicleType    TEXT,
    ModelNo        TEXT,
    RegistrationNo TEXT,
    Capacity       TEXT,
    SerialNo       TEXT,
    Site           TEXT,
    Remark         TEXT
);

-- ============ Editable price lists ============
-- Detailed filter price book (seeded from Filters Prices.xlsx, 195 rows)
CREATE TABLE IF NOT EXISTS FilterPrices (
    PriceID            INTEGER PRIMARY KEY AUTOINCREMENT,
    SupplierFilterCode TEXT,
    Description        TEXT,
    QuotedQty          INTEGER DEFAULT 1,
    UnitPriceLKR       REAL DEFAULT 0,
    TotalPriceLKR      REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_FP_Code ON FilterPrices (SupplierFilterCode);

-- Oil master list (drives the service form + editable in Price Lists)
CREATE TABLE IF NOT EXISTS OilList (
    OilID     INTEGER PRIMARY KEY AUTOINCREMENT,
    Name      TEXT NOT NULL,
    UnitPrice REAL NOT NULL DEFAULT 0,
    Unit      TEXT DEFAULT 'L',
    SortOrder INTEGER DEFAULT 0,
    Active    INTEGER DEFAULT 1
);

-- Filter category master list (drives the service form filter rows)
CREATE TABLE IF NOT EXISTS FilterCategoryList (
    CategoryID INTEGER PRIMARY KEY AUTOINCREMENT,
    Name       TEXT NOT NULL,
    UnitPrice  REAL NOT NULL DEFAULT 0,
    SortOrder  INTEGER DEFAULT 0,
    Active     INTEGER DEFAULT 1
);

-- ============ Service records ============
CREATE TABLE IF NOT EXISTS ServiceJobs (
    ServiceID        INTEGER PRIMARY KEY AUTOINCREMENT,
    VehicleID        INTEGER,
    VehicleLabel     TEXT,
    ServiceDate      TEXT,
    JobNo            TEXT,
    MeterReading     TEXT,
    NextServiceMeter TEXT,
    ServiceType      TEXT,
    SiteLocation     TEXT,
    UpkeepingStatus  TEXT,
    RepairDetails    TEXT,
    PartsSubtotal    REAL DEFAULT 0,
    LabourRate       REAL DEFAULT 0,
    LabourCharge     REAL DEFAULT 0,
    SundryRate       REAL DEFAULT 0,
    SundryAmount     REAL DEFAULT 0,
    GrandTotal       REAL DEFAULT 0,
    CreatedAt        TEXT DEFAULT (datetime('now')),
    UpdatedAt        TEXT
);
CREATE INDEX IF NOT EXISTS idx_SJ_Vehicle ON ServiceJobs (VehicleID);
CREATE INDEX IF NOT EXISTS idx_SJ_Date    ON ServiceJobs (ServiceDate);

CREATE TABLE IF NOT EXISTS ServiceOils (
    ServiceOilID INTEGER PRIMARY KEY AUTOINCREMENT,
    ServiceID    INTEGER NOT NULL REFERENCES ServiceJobs(ServiceID) ON DELETE CASCADE,
    OilName      TEXT,
    OilType      TEXT,
    ActionType   TEXT,
    Quantity     REAL DEFAULT 0,
    Price        REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_SO_Service ON ServiceOils (ServiceID);

CREATE TABLE IF NOT EXISTS ServiceFilters (
    ServiceFilterID INTEGER PRIMARY KEY AUTOINCREMENT,
    ServiceID       INTEGER NOT NULL REFERENCES ServiceJobs(ServiceID) ON DELETE CASCADE,
    FilterCategory  TEXT,
    FilterNo        TEXT,
    ActionType      TEXT,
    Quantity        INTEGER DEFAULT 1,
    Price           REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_SF_Service ON ServiceFilters (ServiceID);

CREATE TABLE IF NOT EXISTS ServiceCosts (
    CostID          INTEGER PRIMARY KEY AUTOINCREMENT,
    ServiceID       INTEGER NOT NULL REFERENCES ServiceJobs(ServiceID) ON DELETE CASCADE,
    CostDescription TEXT,
    Unit            TEXT,
    Rate            REAL DEFAULT 0,
    Qty             REAL DEFAULT 0,
    Amount          REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_SC_Service ON ServiceCosts (ServiceID);

CREATE TABLE IF NOT EXISTS OilPrices (
    PriceID            INTEGER PRIMARY KEY AUTOINCREMENT,
    OilTypeCode        TEXT,
    Description        TEXT,
    UnitPriceLKR       REAL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_OP_Code ON OilPrices (OilTypeCode);

-- ============ App settings (key/value) ============
CREATE TABLE IF NOT EXISTS Settings (
    Key   TEXT PRIMARY KEY,
    Value TEXT
);

-- ============ Users & sessions (authentication) ============
CREATE TABLE IF NOT EXISTS Users (
    UserID             INTEGER PRIMARY KEY AUTOINCREMENT,
    Username           TEXT UNIQUE NOT NULL,
    FullName           TEXT DEFAULT '',
    PasswordHash       TEXT NOT NULL,
    PasswordSalt       TEXT NOT NULL,
    Role               TEXT NOT NULL DEFAULT 'user',     -- 'admin' | 'user'
    Active             INTEGER NOT NULL DEFAULT 1,
    MustChangePassword INTEGER NOT NULL DEFAULT 0,
    CreatedAt          TEXT DEFAULT (datetime('now')),
    LastLoginAt        TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_Users_Username ON Users (Username);

CREATE TABLE IF NOT EXISTS Sessions (
    Token     TEXT PRIMARY KEY,
    UserID    INTEGER NOT NULL REFERENCES Users(UserID) ON DELETE CASCADE,
    CreatedAt TEXT DEFAULT (datetime('now')),
    ExpiresAt TEXT NOT NULL,
    UserAgent TEXT
);
CREATE INDEX IF NOT EXISTS idx_Sessions_User ON Sessions (UserID);

-- ============ Service record attachments (PDF / images / docs) ============
CREATE TABLE IF NOT EXISTS ServiceAttachments (
    AttachmentID INTEGER PRIMARY KEY AUTOINCREMENT,
    ServiceID    INTEGER NOT NULL REFERENCES ServiceJobs(ServiceID) ON DELETE CASCADE,
    StoredName   TEXT NOT NULL,        -- name on disk (data/attachments/<id>/...)
    OriginalName TEXT NOT NULL,
    MimeType     TEXT,
    FileSize     INTEGER DEFAULT 0,
    Caption      TEXT DEFAULT '',
    UploadedBy   INTEGER,
    UploadedAt   TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_Att_Service ON ServiceAttachments (ServiceID);

-- ============ Filter cross-reference index (advanced equivalence search) ============
-- One row per (filter, part-number) pair. FilterID is a plain integer (NOT a FK)
-- so that re-seeding the Filters catalog never cascade-deletes manual entries.
CREATE TABLE IF NOT EXISTS FilterCrossRefs (
    XRefID       INTEGER PRIMARY KEY AUTOINCREMENT,
    FilterID     INTEGER,
    Brand        TEXT DEFAULT '',
    PartNumber   TEXT NOT NULL,
    NormalizedPN TEXT NOT NULL,
    RefType      TEXT DEFAULT 'cross',   -- 'oem' | 'hifi' | 'cross' | 'manual'
    Note         TEXT DEFAULT '',
    Source       TEXT DEFAULT 'auto',    -- 'auto' (parsed) | 'manual' (user added)
    CreatedAt    TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_XRef_Norm   ON FilterCrossRefs (NormalizedPN);
CREATE INDEX IF NOT EXISTS idx_XRef_Filter ON FilterCrossRefs (FilterID);
CREATE INDEX IF NOT EXISTS idx_XRef_Brand  ON FilterCrossRefs (Brand);
`);

// Lightweight migration: add the Quantity column to ServiceFilters if upgrading an older DB.
try {
    const cols = db.prepare("PRAGMA table_info(ServiceFilters)").all();
    if (!cols.some(c => c.name === 'Quantity')) {
        db.exec("ALTER TABLE ServiceFilters ADD COLUMN Quantity INTEGER DEFAULT 1");
    }
} catch (e) {
    console.error("Migration error (ServiceFilters Quantity):", e.message);
}

// ------------------------------------------------------------
//  Default settings (only inserted if missing)
// ------------------------------------------------------------
const DEFAULT_SETTINGS = {
    labour_rate_low:   '20',     // % applied when parts subtotal <= threshold
    labour_rate_high:  '15',     // % applied when parts subtotal >  threshold
    labour_threshold:  '10000',  // LKR break point
    sundry_rate:       '5',      // % of parts subtotal
    currency:          'Rs',
    company_name:      'Edward and Christie (Pvt) Ltd',
    form_title:        'Vehicle/ Machinery Service Details'
};

const insertSetting = db.prepare('INSERT OR IGNORE INTO Settings (Key, Value) VALUES (?, ?)');
for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) insertSetting.run(k, v);

// ------------------------------------------------------------
//  Default oil + filter-category lists (only if tables are empty)
// ------------------------------------------------------------
const DEFAULT_OILS = [
    'Engine Oil', 'Gear Box Oil', 'Differential Oil', 'Transmission Oil', 'Hydraulic Oil',
    'Torque Con. Oil', 'Power Steering Oil', 'Brake Oil', 'Swing Motor Oil', 'Travelling Motor Oil',
    'Rear Axel Case Oil', 'Front Axel Case Oil', 'Circle Gear Case Oil', 'Tandem Drive Oil',
    'Compressor Oil', 'Petrol & Kerosene Oil', 'Grease', 'Battery water', 'Coolant'
];
const DEFAULT_FILTER_CATEGORIES = [
    'Engine Oil Filter', 'Air Filter', 'Air Filter Inner', 'Air Filter Outer', 'Trans: Filter',
    'Water Separator', 'Fuel Sedimentary', 'Hydraulic Filter - S', 'Line Filter', 'Coolant Filter',
    'Power Steering Filter', 'Air Dryer Filter', 'Air Breather Filter', 'Fuel Tank Filter',
    'Primary Fuel Filter', 'Engine fuel Filter - S', 'Engine Oil Filter - S', 'Engine Air Filter - S'
];

if (db.prepare('SELECT COUNT(*) c FROM OilList').get().c === 0) {
    const ins = db.prepare('INSERT INTO OilList (Name, UnitPrice, Unit, SortOrder) VALUES (?, 0, ?, ?)');
    DEFAULT_OILS.forEach((name, i) => ins.run(name, name === 'Grease' ? 'kg' : 'L', i));
}
if (db.prepare('SELECT COUNT(*) c FROM FilterCategoryList').get().c === 0) {
    const ins = db.prepare('INSERT INTO FilterCategoryList (Name, UnitPrice, SortOrder) VALUES (?, 0, ?)');
    DEFAULT_FILTER_CATEGORIES.forEach((name, i) => ins.run(name, i));
}

const DEFAULT_OIL_PRICES = [
    { code: '15W40-CI/04', desc: 'Engine oil,Compressor Oil', price: 1475.00 },
    { code: '80W90 Gear Oil', desc: 'Gear Box Oil Differential Oil Rear Axle Case Oil Front Axle Case Oil Transfer Case', price: 1960.00 },
    { code: 'DS-10 Grease', desc: 'Grease Circle Gear Case Front/Rear Axle Pins', price: 1850.00 },
    { code: 'HD-68', desc: 'Hydraulic Oil Swing Motor Oil Travelling Motor Oil', price: 1200.00 },
    { code: 'MP-140 Gear Oil', desc: 'Gear Box Oil Differential Oil Rear Axle Case Oil Front Axle Case Oil Tandem Drive Oil Circle Gear Case Oil', price: 1680.00 },
    { code: 'MP-90 Gear Oil', desc: 'Gear Box Oil Differential Oil Rear Axle Case Oil Tandem Drive Oil', price: 1680.00 },
    { code: 'Power Oil-1888', desc: 'Power Steering Oil Brake Oil Torque Con. Oil Hydraulic Oil', price: 2320.00 },
    { code: 'SAE-30', desc: 'Engine Oil Compressor Oil Gear Box Oi', price: 1685.00 }
];

if (db.prepare('SELECT COUNT(*) c FROM OilPrices').get().c === 0) {
    const ins = db.prepare('INSERT INTO OilPrices (OilTypeCode, Description, UnitPriceLKR) VALUES (?, ?, ?)');
    DEFAULT_OIL_PRICES.forEach(p => ins.run(p.code, p.desc, p.price));
}

// ------------------------------------------------------------
//  Settings helpers
// ------------------------------------------------------------
function getSettings() {
    const rows = db.prepare('SELECT Key, Value FROM Settings').all();
    const out = {};
    for (const r of rows) out[r.Key] = r.Value;
    return out;
}

function getRates() {
    const s = getSettings();
    return {
        labourRateLow:  parseFloat(s.labour_rate_low)  || 0,
        labourRateHigh: parseFloat(s.labour_rate_high) || 0,
        labourThreshold: parseFloat(s.labour_threshold) || 0,
        sundryRate:     parseFloat(s.sundry_rate)      || 0
    };
}

// Single source of truth for the money math (mirrored on the client for live preview)
function computeTotals(partsSubtotal, rates = getRates()) {
    const parts = Math.round((Number(partsSubtotal) || 0) * 100) / 100;
    const labourRate = parts > rates.labourThreshold ? rates.labourRateHigh : rates.labourRateLow;
    const labourCharge = Math.round(parts * labourRate) / 100;
    const sundryAmount = Math.round(parts * rates.sundryRate) / 100;
    const grandTotal = Math.round((parts + labourCharge + sundryAmount) * 100) / 100;
    return { partsSubtotal: parts, labourRate, labourCharge, sundryRate: rates.sundryRate, sundryAmount, grandTotal };
}

module.exports = { db, getSettings, getRates, computeTotals, DB_PATH };
