const { db } = require('../db');

try {
    const vCount = db.prepare('SELECT COUNT(*) c FROM Vehicles').get().c;
    console.log("Vehicles Count:", vCount);
    
    const categories = db.prepare('SELECT * FROM FilterCategoryList').all();
    console.log("Filter Categories:", categories.map(c => c.Name));
    
    const oils = db.prepare('SELECT * FROM OilList').all();
    console.log("Oil List:", oils.map(o => o.Name));

    const sCount = db.prepare('SELECT COUNT(*) c FROM ServiceJobs').get().c;
    console.log("Service Jobs Count:", sCount);

    // Let's also print 5 vehicles for reference
    const sampleVehicles = db.prepare('SELECT VehicleID, ECNumber, RegistrationNo, Brand, ModelNo, VehicleType FROM Vehicles LIMIT 5').all();
    console.log("Sample Vehicles:", sampleVehicles);

} catch (err) {
    console.error("Database query error:", err.message);
}
