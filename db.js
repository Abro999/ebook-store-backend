// Minimal file-based storage for orders and download tokens.
// Good enough for a single-product store with modest volume.
// If you outgrow this, swap it for a real database (Postgres/SQLite) —
// every function here keeps the same shape so the rest of the app
// doesn't need to change.

const fs = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "data", "orders.json");

function readAll() {
  if (!fs.existsSync(DB_PATH)) return {};
  const raw = fs.readFileSync(DB_PATH, "utf-8").trim();
  return raw ? JSON.parse(raw) : {};
}

function writeAll(data) {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function saveOrder(order) {
  const all = readAll();
  all[order.razorpayOrderId] = order;
  writeAll(all);
}

function getOrderByRazorpayId(razorpayOrderId) {
  const all = readAll();
  return all[razorpayOrderId] || null;
}

function saveDownloadToken(tokenRecord) {
  const all = readAll();
  all[`token:${tokenRecord.token}`] = tokenRecord;
  writeAll(all);
}

function getDownloadToken(token) {
  const all = readAll();
  return all[`token:${token}`] || null;
}

function incrementTokenUse(token) {
  const all = readAll();
  const key = `token:${token}`;
  if (all[key]) {
    all[key].usesCount = (all[key].usesCount || 0) + 1;
    writeAll(all);
  }
}

module.exports = {
  saveOrder,
  getOrderByRazorpayId,
  saveDownloadToken,
  getDownloadToken,
  incrementTokenUse,
};
