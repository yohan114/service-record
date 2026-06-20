const { db } = require('../db');

try {
    const nonZeroJobs = db.prepare("SELECT ServiceID, VehicleLabel, ServiceDate, GrandTotal, CreatedAt FROM ServiceJobs WHERE GrandTotal > 0").all();
    console.log("Service Jobs with GrandTotal > 0:", nonZeroJobs);
} catch (err) {
    console.error("Error:", err.message);
}
