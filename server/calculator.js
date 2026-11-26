/**
 * calculator.js
 * คำนวณยอดเงินอย่างละเอียด รองรับทั้งบิลแจกแจงรายการ และสลิปโอนเงินก้อน
 */

function calculateBill(bill, members) {
  const memberTotals = {};
  members.forEach(m => {
    memberTotals[m.id] = {
      memberId: m.id,
      name: m.name,
      subtotal: 0,
      serviceChargeShare: 0,
      vatShare: 0,
      discountShare: 0,
      total: 0,
      itemsConsumed: []
    };
  });

  let totalItemsAmount = 0;

  const validMemberIds = new Set(members.map(m => m.id));

  // 1. กรณีมีรายการแจกแจง (Itemized items)
  if (bill.items && bill.items.length > 0) {
    bill.items.forEach(item => {
      const itemTotalPrice = parseFloat(item.price) || 0;
      const totalQty = parseInt(item.qty, 10) || 1;
      const unitPrice = totalQty > 0 ? (itemTotalPrice / totalQty) : itemTotalPrice;
      totalItemsAmount += itemTotalPrice;

      // 1.1 คำนวณคนที่ระบุจำนวนกินจริง (เช่น คนมาทีหลัง/กินน้อย เช่น เบียร์ 22 ขวด แต่กินแค่ 2 ขวด)
      const customConsumers = item.customConsumers || {};
      let customTotalCost = 0;

      for (const [memId, q] of Object.entries(customConsumers)) {
        if (validMemberIds.has(memId) && q > 0) {
          const qtyForMem = Math.min(q, totalQty);
          const costForMem = Math.round(qtyForMem * unitPrice * 100) / 100;
          customTotalCost += costForMem;

          if (memberTotals[memId]) {
            memberTotals[memId].subtotal += costForMem;
            memberTotals[memId].itemsConsumed.push({
              itemId: item.id,
              name: `${item.name} (${qtyForMem} ขวด/ชิ้น)`,
              share: costForMem,
              category: item.category
            });
          }
        }
      }

      // 1.2 ส่วนที่เหลือ คิดหารเท่าให้กับเพื่อนที่ติ๊กกินปกติ (ไม่รวมคนที่ระบุจำนวนขวดแล้ว)
      const generalConsumers = (item.consumers || []).filter(id => validMemberIds.has(id) && !customConsumers[id]);
      const generalCount = generalConsumers.length;
      const remainingCost = Math.max(0, itemTotalPrice - customTotalCost);

      if (generalCount > 0 && remainingCost > 0) {
        const share = remainingCost / generalCount;
        generalConsumers.forEach(memberId => {
          if (memberTotals[memberId]) {
            memberTotals[memberId].subtotal += share;
            memberTotals[memberId].itemsConsumed.push({
              itemId: item.id,
              name: item.name,
              share: share,
              category: item.category
            });
          }
        });
      }
    });
  }

  // 2. กรณีเป็นสลิปโอนเงินก้อน (Lump-sum Payment Slip) เช่น ค่าเหล้า/เบียร์/น้ำแข็ง ที่โอนจ่ายไปเลย
  if (bill.slipAmount && bill.slipAmount > 0) {
    const slipAmt = parseFloat(bill.slipAmount) || 0;
    const slipConsumers = bill.slipConsumers || [];
    const count = slipConsumers.length;
    totalItemsAmount += slipAmt;

    if (count > 0) {
      const share = slipAmt / count;
      slipConsumers.forEach(memberId => {
        if (memberTotals[memberId]) {
          memberTotals[memberId].subtotal += share;
          memberTotals[memberId].itemsConsumed.push({
            itemId: 'slip_' + bill.id,
            name: (bill.slipTags && bill.slipTags.length > 0 ? bill.slipTags.join(' + ') : 'สลิปโอนเงิน') + (bill.title ? ` (${bill.title})` : ''),
            share: share,
            category: 'slip'
          });
        }
      });
    }
  }

  // 3. คำนวณ Service Charge, VAT และส่วนลด
  const serviceRate = (bill.serviceCharge || 0) / 100;
  const vatRate = (bill.vat || 0) / 100;
  const discount = bill.discount || 0;

  let billGrandTotal = 0;

  Object.values(memberTotals).forEach(m => {
    if (m.subtotal > 0 && totalItemsAmount > 0) {
      const proportion = m.subtotal / totalItemsAmount;
      m.discountShare = discount * proportion;
      const afterDiscount = Math.max(0, m.subtotal - m.discountShare);
      m.serviceChargeShare = afterDiscount * serviceRate;
      m.vatShare = (afterDiscount + m.serviceChargeShare) * vatRate;
      m.total = Math.round((afterDiscount + m.serviceChargeShare + m.vatShare) * 100) / 100;
    } else {
      m.total = 0;
    }
    billGrandTotal += m.total;
  });

  return {
    billId: bill.id,
    title: bill.title,
    payerId: bill.payerId,
    totalItemsAmount,
    billGrandTotal: Math.round(billGrandTotal * 100) / 100,
    memberTotals
  };
}

/**
 * คำนวณสรุปยอดรวมของห้อง
 * - Direct: แต่ละคนโอนให้คนจ่ายของแต่ละบิล
 * - Net: หักลบกลบหนี้
 */
function calculateRoomSummary(room) {
  const members = room.members || [];
  const bills = room.bills || [];

  const billCalculations = bills.map(b => calculateBill(b, members));

  // หนี้สินโดยตรง (Direct Transfers): ใครต้องโอนให้คนจ่ายของบิลไหนเท่าไหร่
  const directTransfers = [];
  // สรุปยอดสุทธิของแต่ละคน (Net Balance)
  const netBalances = {};
  members.forEach(m => {
    netBalances[m.id] = {
      memberId: m.id,
      name: m.name,
      promptpay: m.promptpay,
      avatar: m.avatar,
      paidTotal: 0,
      consumedTotal: 0,
      net: 0 // + คือได้เงินคืน, - คือต้องจ่ายออก
    };
  });

  billCalculations.forEach(bc => {
    const payer = members.find(m => m.id === bc.payerId);
    const payerName = payer ? payer.name : 'คนสำรองจ่าย';
    const payerPromptPay = payer ? payer.promptpay : '';

    Object.values(bc.memberTotals).forEach(mt => {
      // บันทึกยอดที่บริโภค
      if (netBalances[mt.memberId]) {
        netBalances[mt.memberId].consumedTotal += mt.total;
      }

      // ถ้าคนนี้ไม่ใช่คนจ่าย และมียอดต้องจ่ายในบิลนี้
      if (mt.memberId !== bc.payerId && mt.total > 0) {
        directTransfers.push({
          fromId: mt.memberId,
          fromName: mt.name,
          toId: bc.payerId,
          toName: payerName,
          toPromptPay: payerPromptPay,
          billId: bc.billId,
          billTitle: bc.title,
          amount: mt.total,
          isPaid: !!(room.transfersPaid && room.transfersPaid[`${mt.memberId}_${bc.billId}`])
        });
      }
    });

    // บันทึกยอดที่คนสำรองจ่ายออกไป
    if (netBalances[bc.payerId]) {
      netBalances[bc.payerId].paidTotal += bc.billGrandTotal;
    }
  });

  // คำนวณ Net
  Object.values(netBalances).forEach(nb => {
    nb.net = Math.round((nb.paidTotal - nb.consumedTotal) * 100) / 100;
  });

  return {
    billCalculations,
    directTransfers,
    netBalances
  };
}

module.exports = {
  calculateBill,
  calculateRoomSummary
};
