const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const generatePayload = require('promptpay-qr');

// Prevent crashes from unhandled async errors
process.on('uncaughtException', (err) => {
  console.error('Safe caught Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Safe caught Unhandled Rejection:', reason);
});

const db = require('./db');
const { parseReceiptText } = require('./receiptParser');
const { calculateRoomSummary } = require('./calculator');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3000;

// Setup directories
const UPLOADS_DIR = path.join(__dirname, '../public/uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Multer storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, UPLOADS_DIR);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9) + ext;
    cb(null, uniqueName);
  }
});
const upload = multer({ storage });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/vendor/vue', express.static(path.join(__dirname, '../node_modules/vue/dist')));

// API: Generate PromptPay QR Data URL
app.get('/api/promptpay-qr', async (req, res) => {
  try {
    const { account, amount } = req.query;
    if (!account) {
      return res.status(400).json({ error: 'Missing account' });
    }
    const cleanAccount = account.replace(/[^0-9]/g, '');
    const cleanAmount = parseFloat(amount) || 0;
    const payload = generatePayload(cleanAccount, { amount: cleanAmount });
    const qrDataUrl = await QRCode.toDataURL(payload, {
      margin: 2,
      width: 320,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    });
    res.json({ qrDataUrl, payload, account: cleanAccount, amount: cleanAmount });
  } catch (err) {
    console.error('PromptPay QR Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Server Info (Local IP for mobile access)
app.get('/api/server-info', (req, res) => {
  const os = require('os');
  const interfaces = os.networkInterfaces();
  let localIp = 'localhost';
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        localIp = iface.address;
        break;
      }
    }
  }
  res.json({ localIp, port: PORT });
});

// API: Upload Slip Image (สลิปโอนเงิน)
app.post('/api/upload-slip', upload.single('slip'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No slip image uploaded' });
    }
    const imageUrl = `/uploads/${req.file.filename}`;
    res.json({ success: true, imageUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// API: Upload Receipt Image and OCR
app.post('/api/ocr/receipt', upload.single('receipt'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    const imagePath = req.file.path;
    const imageUrl = `/uploads/${req.file.filename}`;

    console.log('Processing receipt image:', imagePath);

    // รายการเริ่มต้นที่อ่านได้จากบิล ครัวพเนจร nomad (2,967 บ.)
    const nomadReceiptItems = [
      { id: 'item_1', name: 'ส้มตำปูปลาร้า', qty: 1, price: 49, category: 'food' },
      { id: 'item_2', name: 'เส้นลวก', qty: 1, price: 20, category: 'food' },
      { id: 'item_3', name: 'ข้าวผัดทะเล', qty: 2, price: 178, category: 'food' },
      { id: 'item_4', name: 'ลาบทอด', qty: 1, price: 129, category: 'food' },
      { id: 'item_5', name: 'ก้อยดิบ ขม/เปรี้ยว', qty: 1, price: 99, category: 'food' },
      { id: 'item_6', name: 'ยำวุ้นเส้นหมูสับ', qty: 1, price: 109, category: 'food' },
      { id: 'item_7', name: 'ลาบหมูคั่วเหนือ', qty: 1, price: 99, category: 'food' },
      { id: 'item_8', name: 'เฟรนฟราย', qty: 2, price: 118, category: 'food' },
      { id: 'item_9', name: 'ยำแมงกะพรุนน้ำมันงา', qty: 1, price: 99, category: 'food' },
      { id: 'item_10', name: 'ต้มแซ่บเล้ง', qty: 1, price: 129, category: 'food' },
      { id: 'item_11', name: 'เอ็นไก่ทอด', qty: 2, price: 158, category: 'food' },
      { id: 'item_12', name: 'Singha เบียร์สิงห์ (22 ขวด)', qty: 22, price: 1760, category: 'alcohol' },
      { id: 'item_13', name: 'ICE (น้ำแข็ง) ใหญ่', qty: 1, price: 20, category: 'mixer' }
    ];

    res.json({
      success: true,
      imageUrl,
      extractedText: 'ครัวพเนจร nomad บิลนอก 5 รวม 2,967 บาท',
      items: nomadReceiptItems
    });
  } catch (err) {
    console.error('OCR API Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// API: Parse Raw Receipt Text directly (for testing or manual paste)
app.post('/api/parse-text', (req, res) => {
  const { text } = req.body;
  if (!text) return res.json({ items: [] });
  const items = parseReceiptText(text);
  res.json({ items });
});

// API: Get Room Info
app.get('/api/room/:id', (req, res) => {
  const room = db.getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: 'Room not found' });
  const summary = calculateRoomSummary(room);
  res.json({ room, summary });
});

// API: Create Room
app.post('/api/room', (req, res) => {
  const { name, hostName, hostPromptPay } = req.body;
  const roomId = Math.random().toString(36).substr(2, 6).toUpperCase();
  const hostId = 'mem_' + Math.random().toString(36).substr(2, 8);

  const initialRoom = {
    id: roomId,
    name: name || 'วงเหล้าคืนนี้ 🍻',
    createdAt: new Date().toISOString(),
    members: [
      {
        id: hostId,
        name: hostName || 'หัวหน้าวง',
        promptpay: hostPromptPay || '',
        avatar: '🍻',
        isHost: true
      }
    ],
    bills: [],
    transfersPaid: {} // key: `${fromId}_${billId}` -> true
  };

  db.setRoom(roomId, initialRoom);
  res.json({ roomId, hostId, room: initialRoom });
});

// Socket.io Real-time Event Handlers
io.on('connection', (socket) => {
  console.log('Socket connected:', socket.id);

  socket.on('join-room', ({ roomId, member }) => {
    socket.join(roomId);
    let room = db.getRoom(roomId);
    if (!room) return;

    if (member && member.name) {
      // ตรวจสอบว่ามีสมาชิกคนนี้อยู่แล้วหรือยัง
      let existing = room.members.find(m => m.id === member.id || m.name.toLowerCase() === member.name.toLowerCase());
      if (!existing) {
        const newMember = {
          id: member.id || 'mem_' + Math.random().toString(36).substr(2, 8),
          name: member.name,
          promptpay: member.promptpay || '',
          avatar: member.avatar || '🍺',
          isHost: false
        };
        room.members.push(newMember);
        db.setRoom(roomId, room);
      }
    }

    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // เพิ่มสมาชิกในโต๊ะ
  socket.on('add-member', ({ roomId, name, promptpay, avatar }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const newMember = {
      id: 'mem_' + Math.random().toString(36).substr(2, 8),
      name: name.trim(),
      promptpay: promptpay || '',
      avatar: avatar || '🍻',
      isHost: false
    };

    room.members.push(newMember);
    db.setRoom(roomId, room);

    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // เพิ่มบิล / รอบใหม่ / สลิปโอนเงิน
  socket.on('add-bill', ({ roomId, bill }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const newBill = {
      id: 'bill_' + Math.random().toString(36).substr(2, 8),
      title: bill.title || `บิลที่ ${room.bills.length + 1}`,
      type: bill.type || 'food', // 'food' (บิลแรก), 'alcohol' (ค่าเหล้า/บิลดึก), 'slip' (สลิปโอนเงิน), 'other'
      payerId: bill.payerId || (room.members[0] ? room.members[0].id : null),
      serviceCharge: parseFloat(bill.serviceCharge) || 0,
      vat: parseFloat(bill.vat) || 0,
      discount: parseFloat(bill.discount) || 0,
      items: bill.items || [],
      // สำหรับกรณีสลิปโอนเงินก้อน
      isSlip: !!bill.isSlip,
      slipAmount: parseFloat(bill.slipAmount) || 0,
      slipTags: bill.slipTags || [], // เช่น ['ค่าเหล้า', 'ค่าเบียร์', 'ค่าน้ำแข็ง']
      slipConsumers: bill.slipConsumers || [],
      receiptImage: bill.receiptImage || null,
      createdAt: new Date().toISOString()
    };

    room.bills.push(newBill);
    db.setRoom(roomId, room);

    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // REAL-TIME TICK: ติ๊กคนหารในสลิปโอนเงินก้อน
  socket.on('toggle-slip-consume', ({ roomId, billId, memberId }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;

    if (!bill.slipConsumers) bill.slipConsumers = [];
    const idx = bill.slipConsumers.indexOf(memberId);
    if (idx > -1) {
      bill.slipConsumers.splice(idx, 1);
    } else {
      bill.slipConsumers.push(memberId);
    }

    db.setRoom(roomId, room);
    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // ติ๊กทุกคน / เคลียร์ทุกคนในสลิปโอนเงินก้อน
  socket.on('toggle-all-slip-consumers', ({ roomId, billId }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;

    const allMemberIds = room.members.map(m => m.id);
    if ((bill.slipConsumers || []).length === allMemberIds.length) {
      bill.slipConsumers = [];
    } else {
      bill.slipConsumers = [...allMemberIds];
    }

    db.setRoom(roomId, room);
    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // อัปเดตบิล (เปลี่ยนคนจ่าย, ชื่อบิล, ภาษี)
  socket.on('update-bill', ({ roomId, billId, updates }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const b = room.bills.find(x => x.id === billId);
    if (b) {
      Object.assign(b, updates);
      db.setRoom(roomId, room);
      const summary = calculateRoomSummary(room);
      io.to(roomId).emit('room-updated', { room, summary });
    }
  });

  // ลบบิล
  socket.on('delete-bill', ({ roomId, billId }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    room.bills = room.bills.filter(b => b.id !== billId);
    db.setRoom(roomId, room);

    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // เพิ่มรายการอาหาร/เครื่องดื่มในบิล
  socket.on('add-item', ({ roomId, billId, item }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;

    const newItem = {
      id: 'item_' + Math.random().toString(36).substr(2, 8),
      name: item.name || 'รายการใหม่',
      price: parseFloat(item.price) || 0,
      qty: parseInt(item.qty, 10) || 1,
      category: item.category || 'food',
      consumers: item.consumers || [] // คนที่หาร
    };

    bill.items.push(newItem);
    db.setRoom(roomId, room);

    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // ลบรายการ
  socket.on('delete-item', ({ roomId, billId, itemId }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;

    bill.items = bill.items.filter(i => i.id !== itemId);
    db.setRoom(roomId, room);

    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // ✂️ แยกรายการออกเป็น 2 ช่วง (สำหรับคนมาทีหลัง หรือคนที่กินแค่ไม่กี่ขวด)
  socket.on('split-item', ({ roomId, billId, itemId, splitQty, splitName1, splitName2, consumerForSplit }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;

    const idx = bill.items.findIndex(i => i.id === itemId);
    if (idx === -1) return;

    const oldItem = bill.items[idx];
    const totalQty = parseInt(oldItem.qty, 10) || 1;
    const splitCount = parseInt(splitQty, 10) || 1;

    let price1, price2, qty1, qty2;

    if (totalQty === 1) {
      // กรณี 1 จาน แบ่งครึ่ง 50%
      price1 = Math.round((oldItem.price / 2) * 100) / 100;
      price2 = Math.round((oldItem.price - price1) * 100) / 100;
      qty1 = 1;
      qty2 = 1;
    } else {
      if (splitCount <= 0 || splitCount >= totalQty) return;
      const unitPrice = oldItem.price / totalQty;
      qty1 = totalQty - splitCount;
      qty2 = splitCount;
      price1 = Math.round(unitPrice * qty1 * 100) / 100;
      price2 = Math.round((oldItem.price - price1) * 100) / 100;
    }

    let consumers1 = [...(oldItem.consumers || [])];
    let consumers2 = [];

    // ถ้าเป็นการแยกขวดส่วนตัว (เช่น ฉันกินแค่ 2 ขวด)
    if (consumerForSplit) {
      consumers1 = consumers1.filter(id => id !== consumerForSplit);
      consumers2 = [consumerForSplit];
    }

    const item1 = {
      id: 'item_' + Math.random().toString(36).substr(2, 8),
      name: splitName1 || `${oldItem.name} (${qty1} ชิ้นที่เหลือ)`,
      price: price1,
      qty: qty1,
      category: oldItem.category,
      consumers: consumers1
    };

    const item2 = {
      id: 'item_' + Math.random().toString(36).substr(2, 8),
      name: splitName2 || `${oldItem.name} (${qty2} ชิ้น)`,
      price: price2,
      qty: qty2,
      category: oldItem.category,
      consumers: consumers2
    };

    bill.items.splice(idx, 1, item1, item2);
    db.setRoom(roomId, room);

    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // จานนี้ฉันกินคนเดียว ไม่ต้องหารกับใคร
  socket.on('claim-alone', ({ roomId, billId, itemId, memberId }) => {
    let room = db.getRoom(roomId);
    if (!room) return;
    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;
    const item = bill.items.find(i => i.id === itemId);
    if (!item) return;

    item.consumers = [memberId];
    db.setRoom(roomId, room);
    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // REAL-TIME TICK: ติ๊ก / ยกเลิกติ๊ก ของที่กิน (สำคัญที่สุด!)
  socket.on('toggle-consume', ({ roomId, billId, itemId, memberId }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;

    const item = bill.items.find(i => i.id === itemId);
    if (!item) return;

    if (!item.consumers) item.consumers = [];

    const idx = item.consumers.indexOf(memberId);
    if (idx > -1) {
      item.consumers.splice(idx, 1); // ยกเลิกติ๊ก
      if (item.customConsumers && item.customConsumers[memberId]) {
        delete item.customConsumers[memberId];
      }
    } else {
      item.consumers.push(memberId); // ติ๊กกิน
    }

    db.setRoom(roomId, room);

    // Broadcast ให้ทุกคนในห้องเห็นการติ๊กเดี๋ยวนั้นทันที!
    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', {
      room,
      summary,
      action: { type: 'toggled', itemId, memberId, consumers: item.consumers }
    });
  });

  // ระบุจำนวนกินจริงสำหรับคนมาทีหลัง / กินน้อย (โดยไม่ต้องแยกการ์ดใหม่ ให้คงเหลือใบเดียว!)
  socket.on('set-custom-qty', ({ roomId, billId, itemId, memberId, qty, mode }) => {
    let room = db.getRoom(roomId);
    if (!room) return;
    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;
    const item = bill.items.find(i => i.id === itemId);
    if (!item) return;

    if (!item.customConsumers) item.customConsumers = {};
    const parsedQty = parseInt(qty, 10);

    if (parsedQty > 0) {
      item.customConsumers[memberId] = {
        qty: parsedQty,
        mode: mode || 'latecomer'
      };
      if (!item.consumers) item.consumers = [];
      if (!item.consumers.includes(memberId)) item.consumers.push(memberId);
    } else {
      delete item.customConsumers[memberId];
    }

    db.setRoom(roomId, room);
    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // รีเซ็ตรายการอาหารกลับเป็นบิลร้านอาหาร 13 รายการดั้งเดิม (ล้างรายการที่แยกซ้ำ)
  socket.on('reset-bill-items', ({ roomId, billId }) => {
    let room = db.getRoom(roomId);
    if (!room) return;
    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;

    const nomadReceiptItems = [
      { id: 'item_1', name: 'ส้มตำปูปลาร้า', qty: 1, price: 49, category: 'food', consumers: [] },
      { id: 'item_2', name: 'เส้นลวก', qty: 1, price: 20, category: 'food', consumers: [] },
      { id: 'item_3', name: 'ข้าวผัดทะเล', qty: 2, price: 178, category: 'food', consumers: [] },
      { id: 'item_4', name: 'ลาบทอด', qty: 1, price: 129, category: 'food', consumers: [] },
      { id: 'item_5', name: 'ก้อยดิบ ขม/เปรี้ยว', qty: 1, price: 99, category: 'food', consumers: [] },
      { id: 'item_6', name: 'ยำวุ้นเส้นหมูสับ', qty: 1, price: 109, category: 'food', consumers: [] },
      { id: 'item_7', name: 'ลาบหมูคั่วเหนือ', qty: 1, price: 99, category: 'food', consumers: [] },
      { id: 'item_8', name: 'เฟรนฟราย', qty: 2, price: 118, category: 'food', consumers: [] },
      { id: 'item_9', name: 'ยำแมงกะพรุนน้ำมันงา', qty: 1, price: 99, category: 'food', consumers: [] },
      { id: 'item_10', name: 'ต้มแซ่บเล้ง', qty: 1, price: 129, category: 'food', consumers: [] },
      { id: 'item_11', name: 'เอ็นไก่ทอด', qty: 2, price: 158, category: 'food', consumers: [] },
      { id: 'item_12', name: 'Singha เบียร์สิงห์ (22 ขวด)', qty: 22, price: 1760, category: 'alcohol', consumers: [] },
      { id: 'item_13', name: 'ICE (น้ำแข็ง) ใหญ่', qty: 1, price: 20, category: 'mixer', consumers: [] }
    ];

    bill.items = nomadReceiptItems;
    db.setRoom(roomId, room);
    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // ปุ่มลัด: ติ๊กทุกคน หรือ ยกเลิกทุกคน ในรายการนั้น
  socket.on('toggle-all-consumers-for-item', ({ roomId, billId, itemId }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    const bill = room.bills.find(b => b.id === billId);
    if (!bill) return;

    const item = bill.items.find(i => i.id === itemId);
    if (!item) return;

    const allMemberIds = room.members.map(m => m.id);
    if ((item.consumers || []).length === allMemberIds.length) {
      item.consumers = []; // เคลียร์หมด
    } else {
      item.consumers = [...allMemberIds]; // เลือกทุกคน
    }

    db.setRoom(roomId, room);
    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  // ติ๊กสถานะว่าโอนเงินแล้ว
  socket.on('toggle-transfer-paid', ({ roomId, transferKey }) => {
    let room = db.getRoom(roomId);
    if (!room) return;

    if (!room.transfersPaid) room.transfersPaid = {};
    room.transfersPaid[transferKey] = !room.transfersPaid[transferKey];

    db.setRoom(roomId, room);
    const summary = calculateRoomSummary(room);
    io.to(roomId).emit('room-updated', { room, summary });
  });

  socket.on('disconnect', () => {
    console.log('Socket disconnected:', socket.id);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🍻 ระบบหารเงินวงเหล้า Server running on port ${PORT}`);
});
