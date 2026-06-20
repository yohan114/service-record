const { db } = require('../db');

try {
    const totalJobs = db.prepare("SELECT COUNT(*) c FROM ServiceJobs").get().c;
    console.log("Post-Import Total ServiceJobs Count:", totalJobs);

    const minMaxDate = db.prepare("SELECT MIN(ServiceDate) minDate, MAX(ServiceDate) maxDate FROM ServiceJobs").get();
    console.log("Post-Import Date Range of ServiceJobs:", minMaxDate);

    const nonZeroJobs = db.prepare("SELECT COUNT(*) c FROM ServiceJobs WHERE GrandTotal > 0").get().c;
    console.log("Post-Import Jobs with GrandTotal > 0:", nonZeroJobs);

    const latestJobs = db.prepare("SELECT ServiceID, VehicleID, VehicleLabel, ServiceDate, JobNo, GrandTotal FROM ServiceJobs ORDER BY ServiceID DESC LIMIT 5").all();
    console.log("Latest 5 Service Jobs in DB:", latestJobs);

    const countFilters = db.prepare("SELECT COUNT(*) c FROM ServiceFilters").get().c;
    console.log("Post-Import Service Filters Count:", countFilters);
    
    const countOils = db.prepare("SELECT COUNT(*) c FROM ServiceOils").get().c;
    console.log("Post-Import Service Oils Count:", countOils);

} catch (err) {
    console.error("Database query error:", err.message);
}
