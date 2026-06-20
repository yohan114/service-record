const { db } = require('../db');

try {
    const totalJobs = db.prepare("SELECT COUNT(*) c FROM ServiceJobs").get().c;
    const zeroJobs = db.prepare("SELECT COUNT(*) c FROM ServiceJobs WHERE GrandTotal = 0").get().c;
    console.log("Total Jobs:", totalJobs);
    console.log("Jobs with GrandTotal = 0:", zeroJobs);
    
    // Print 5 samples of jobs with GrandTotal = 0
    if (zeroJobs > 0) {
        const samples = db.prepare("SELECT ServiceID, VehicleLabel, ServiceDate, MeterReading, GrandTotal FROM ServiceJobs WHERE GrandTotal = 0 LIMIT 5").all();
        console.log("Sample 0-total jobs:", samples);
    }
} catch (err) {
    console.error("Error:", err.message);
}
