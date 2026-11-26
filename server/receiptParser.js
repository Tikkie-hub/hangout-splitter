/**
 * receiptParser.js
 * วิเคราะห์และแยกรายการอาหาร เครื่องดื่ม แอลกอฮอล์ และราคาจากข้อความ OCR ใบเสร็จ
 */

const ALCOHOL_KEYWORDS = [
  'เบียร์', 'เหล้า', 'ไวน์', 'วอดก้า', 'แสงโสม', 'หงส์ทอง', 'รีเจนซี่', 'รีเจ้นซี่',
  'black', 'red', 'blue', 'gold', 'singha', 'chang', 'leo', 'heineken', 'corona',
  'tower', 'ทาวเวอร์', 'เหยือก', 'ขวด', 'shot', 'ช็อต', 'cocktail', 'ค็อกเทล',
  'soju', 'โซจู', 'วิสกี้', 'whisky', 'whiskey', 'blend', 'smirnoff', 'vodka', 'beer'
];

const MIXER_KEYWORDS = [
  'โซดา', 'โค้ก', 'coke', 'pepsi', 'เป๊ปซี่', 'สไปรท์', 'sprite', 'น้ำแข็ง',
  'ถังน้ำแข็ง', 'มิกเซอร์', 'mixer', 'โทนิค', 'tonic', 'สิงห์โซดา'
];

function categorizeItem(name) {
  const lower = name.toLowerCase();
  if (ALCOHOL_KEYWORDS.some(k => lower.includes(k))) {
    return 'alcohol'; // แอลกอฮอล์
  }
  if (MIXER_KEYWORDS.some(k => lower.includes(k))) {
    return 'mixer'; // มิกเซอร์ / น้ำแข็ง
  }
  return 'food'; // อาหาร / กับแกล้ม ทั่วไป
}

/**
 * แปลงข้อความใบเสร็จเป็นรายการสินค้า
 * @param {string} text - ข้อความที่อ่านได้จาก OCR
 * @returns {Array<{name: string, qty: number, price: number, category: string}>}
 */
function parseReceiptText(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];

  // มองหาบรรทัดที่มีราคา เช่น "ข้าวผัดปู 1 120" หรือ "เบียร์ช้าง 3 270.00"
  // รูปแบบ: ชื่อสินค้า (อาจมีจำนวน) ตามด้วยตัวเลขราคา
  const priceRegex = /([0-9]+[.,][0-9]{2}|[0-9]{2,5})\s*$/;

  for (const line of lines) {
    // ข้ามบรรทัดที่เป็นหัวบิล หรือยอดรวม
    if (/รวม|total|subtotal|vat|ภาษี|บริการ|service|cash|change|ทอน|ขอบคุณ|thank/i.test(line)) {
      continue;
    }

    const match = line.match(priceRegex);
    if (match) {
      let rawPrice = match[1].replace(/,/g, '');
      let price = parseFloat(rawPrice);
      if (isNaN(price) || price <= 0) continue;

      let namePart = line.substring(0, match.index).trim();
      
      // ดึงจำนวนออกมาถ้ามี เช่น "x 2" หรือตัวเลขก่อนราคา
      let qty = 1;
      const qtyMatch = namePart.match(/(?:x|\*|\s)([0-9]+)\s*$/i);
      if (qtyMatch) {
        qty = parseInt(qtyMatch[1], 10) || 1;
        namePart = namePart.substring(0, qtyMatch.index).trim();
      }

      // ทำความสะอาดชื่อ
      namePart = namePart.replace(/^[\d\s.\-*#]+/, '').trim();
      if (!namePart || namePart.length < 2) continue;

      items.push({
        id: 'item_' + Math.random().toString(36).substr(2, 9),
        name: namePart,
        qty: qty,
        price: price,
        category: categorizeItem(namePart),
        consumers: [] // รายชื่อ id คนที่กิน
      });
    }
  }

  return items;
}

module.exports = {
  parseReceiptText,
  categorizeItem
};
