const { db } = require('../db');

try {
    const sampleOils = db.prepare("SELECT * FROM ServiceOils WHERE Price > 0 LIMIT 5").all();
    console.log("Sample non-zero oils in DB:", sampleOils);

    const sampleFilters = db.prepare("SELECT * FROM ServiceFilters WHERE Price > 0 LIMIT 5").all();
    console.log("Sample non-zero filters in DB:", sampleFilters);
} catch (err) {
    console.error("Error:", err.message);
}
