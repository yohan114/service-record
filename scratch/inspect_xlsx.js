const XLSX = require('xlsx');
const path = require('path');

const file = path.join('d:', 'Yohan', 'service record system', 'Service record.xlsx');
try {
    const workbook = XLSX.readFile(file);
    console.log("Sheet names:", workbook.SheetNames);
    
    // Find sheet that matches 'summary' or 'summery' (case insensitive)
    const targetSheetName = workbook.SheetNames.find(s => s.toLowerCase() === 'summary' || s.toLowerCase() === 'summery');
    console.log("Target Sheet Name:", targetSheetName);
    
    if (targetSheetName) {
        const worksheet = workbook.Sheets[targetSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        console.log("Total rows in sheet:", rows.length);
        if (rows.length > 0) {
            console.log("Columns:", Object.keys(rows[0]));
            console.log("Sample Row 0:", rows[0]);
            console.log("Sample Row 1:", rows[1]);
        }
    } else {
        console.log("No sheet named Summary or Summery found.");
    }
} catch (err) {
    console.error("Error reading file:", err.message);
}
