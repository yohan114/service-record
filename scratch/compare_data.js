const XLSX = require('xlsx');
const path = require('path');
const { db } = require('../db');

const excelFile = path.join('d:', 'Yohan', 'service record system', 'Service record.xlsx');
try {
    const workbook = XLSX.readFile(excelFile);
    const targetSheetName = workbook.SheetNames.find(s => s.toLowerCase() === 'summary' || s.toLowerCase() === 'summery');
    const worksheet = workbook.Sheets[targetSheetName];
    const excelRows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    console.log("Excel Total Rows:", excelRows.length);
    
    // Parse Excel dates to compare
    let minExDate = null;
    let maxExDate = null;
    let excelJobNos = new Set();
    
    excelRows.forEach(row => {
        let dateStr = row.Date;
        if (dateStr) {
            // Excel dates can be parsed
            let parsedDate = null;
            if (typeof dateStr === 'string') {
                const parts = dateStr.split('.');
                if (parts.length === 3) {
                    parsedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
            }
            if (parsedDate) {
                if (!minExDate || parsedDate < minExDate) minExDate = parsedDate;
                if (!maxExDate || parsedDate > maxExDate) maxExDate = parsedDate;
            }
        }
        
        let jobNo = (row['job no.'] || row['job no#'] || '').toString().trim();
        if (jobNo) {
            excelJobNos.add(jobNo);
        }
    });

    console.log("Excel Date Range:", minExDate, "to", maxExDate);
    console.log("Excel Unique Job Numbers:", excelJobNos.size);

    // Query DB Job Numbers
    const dbJobs = db.prepare("SELECT JobNo, ServiceDate, VehicleLabel FROM ServiceJobs").all();
    console.log("DB Total Jobs:", dbJobs.length);
    
    let dbJobNos = new Set();
    dbJobs.forEach(j => {
        if (j.JobNo) {
            dbJobNos.add(j.JobNo.trim());
        }
    });
    console.log("DB Unique Job Numbers:", dbJobNos.size);

    // Let's see how many match
    let matchCount = 0;
    excelJobNos.forEach(job => {
        if (dbJobNos.has(job)) {
            matchCount++;
        }
    });
    console.log("Number of Excel job numbers already in DB:", matchCount);

} catch (err) {
    console.error("Comparison error:", err.message);
}
