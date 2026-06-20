const { db } = require('../db');

try {
    const vehicles = db.prepare("SELECT * FROM Vehicles WHERE RegistrationNo LIKE '%4193%' OR ECNumber LIKE '%4193%'").all();
    console.log("Vehicles matching 4193:", vehicles);
} catch (err) {
    console.error("Error:", err.message);
}
