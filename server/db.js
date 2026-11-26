const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '../data');
const ROOMS_FILE = path.join(DATA_DIR, 'rooms.json');

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let rooms = {};

// โหลดข้อมูลเก่าถ้ามี
try {
  if (fs.existsSync(ROOMS_FILE)) {
    const data = fs.readFileSync(ROOMS_FILE, 'utf-8');
    rooms = JSON.parse(data) || {};
  }
} catch (err) {
  console.error('Error loading rooms.json:', err);
  rooms = {};
}

function saveRooms() {
  try {
    fs.writeFileSync(ROOMS_FILE, JSON.stringify(rooms, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error saving rooms.json:', err);
  }
}

function sanitizeRoom(room) {
  if (!room || !room.members) return room;
  const validMemberIds = new Set(room.members.map(m => m.id));
  if (room.bills) {
    room.bills.forEach(bill => {
      if (bill.slipConsumers) {
        bill.slipConsumers = bill.slipConsumers.filter(id => validMemberIds.has(id));
      }
      if (bill.items) {
        bill.items.forEach(item => {
          if (item.consumers) {
            item.consumers = item.consumers.filter(id => validMemberIds.has(id));
          }
        });
      }
    });
  }
  return room;
}

function getRoom(id) {
  const r = rooms[id] || null;
  return r ? sanitizeRoom(r) : null;
}

function setRoom(id, roomData) {
  rooms[id] = sanitizeRoom(roomData);
  saveRooms();
  return rooms[id];
}

function deleteRoom(id) {
  delete rooms[id];
  saveRooms();
}

module.exports = {
  rooms,
  getRoom,
  setRoom,
  deleteRoom,
  saveRooms
};
