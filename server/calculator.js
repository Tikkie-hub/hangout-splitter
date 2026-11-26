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

      // กรองเฉพาะสมาชิกที่มีอยู่จริงในห้อง
      const rawConsumers = (item.consumers || []).filter(id => validMemberIds.has(id));
      const customConsumers = item.customConsumers || {};

      // รวมสมาชิกทุกคนที่กินรายการนี้
      const allConsumerIds = Array.from(new Set([
        ...rawConsumers,
        ...Object.keys(customConsumers).filter(id => {
          const val = customConsumers[id];
          return validMemberIds.has(id) && (typeof val === 'object' ? val.qty > 0 : val > 0);
        })
      ]));

      if (allConsumerIds.length === 0) return;

      // ตรวจสอบสมาชิกแต่ละคน:
      // - solo: กินคนเดียว ไม่หารใคร (qty * unitPrice)
      // - latecomer: มาทีหลัง ดื่มช่วงท้าย X ขวด (หารร่วมกับเพื่อนในโต๊ะ)
      // - full: กินตั้งแต่ต้นจนจบ (totalQty ขวด)
      let soloTotalCost = 0;
      let soloQtyTotal = 0;

      const memberConfig = {};
      allConsumerIds.forEach(memId => {
        const val = customConsumers[memId];
        if (val) {
          if (typeof val === 'object') {
            memberConfig[memId] = {
              mode: val.mode || 'latecomer',
              qty: Math.min(totalQty, Math.max(1, parseInt(val.qty, 10) || 1))
            };
          } else {
            // backward compatibility: number -> latecomer (มาร่วมดื่มช่วงท้าย X ขวด)
            const q = Math.min(totalQty, Math.max(1, parseInt(val, 10) || 1));
            memberConfig[memId] = {
              mode: 'latecomer',
              qty: q
            };
          }
        } else {
          // คนที่ติ๊กหารปกติ อยู่กินเต็มเวลา
          memberConfig[memId] = {
            mode: 'full',
            qty: totalQty
          };
        }
      });

      // 1.1 คิดยอด Solo ก่อน (ถ้ามีใครเลือกกินคนเดียว ไม่หารใคร)
      Object.entries(memberConfig).forEach(([memId, cfg]) => {
        if (cfg.mode === 'solo') {
          const cost = Math.round(cfg.qty * unitPrice * 100) / 100;
          soloTotalCost += cost;
          soloQtyTotal += cfg.qty;
          if (memberTotals[memId]) {
            memberTotals[memId].subtotal += cost;
            memberTotals[memId].itemsConsumed.push({
              itemId: item.id,
              name: `${item.name} (${cfg.qty} ชิ้น กินคนเดียว)`,
              share: cost,
              category: item.category
            });
          }
        }
      });

      // 1.2 สมาชิกที่ร่วมหารในโต๊ะ (ทั้ง full และ latecomer ที่มาร่วมดื่มช่วงท้าย)
      const sharedMembers = allConsumerIds.filter(id => memberConfig[id].mode !== 'solo');
      const sharedTotalQty = Math.max(1, totalQty - soloQtyTotal);
      const sharedTotalPrice = Math.max(0, itemTotalPrice - soloTotalCost);
      const sharedUnitPrice = sharedTotalPrice / sharedTotalQty;

      if (sharedMembers.length > 0 && sharedTotalPrice > 0) {
        // จำลองขวด 1 .. sharedTotalQty
        // สมาชิกจะร่วมดื่มขวด b เมื่อ b > (sharedTotalQty - cfg.qty)
        // เช่น totalQty 22, เพลงทัน 8 ขวดหลัง -> ดื่มขวด 15..22
        const memberItemShares = {};
        sharedMembers.forEach(id => { memberItemShares[id] = 0; });

        for (let b = 1; b <= sharedTotalQty; b++) {
          const drinkersForBottle = sharedMembers.filter(id => {
            const q = memberConfig[id].qty;
            return b > (sharedTotalQty - q);
          });

          if (drinkersForBottle.length > 0) {
            const bottleShare = sharedUnitPrice / drinkersForBottle.length;
            drinkersForBottle.forEach(id => {
              memberItemShares[id] += bottleShare;
            });
          }
        }

        // บันทึกยอดที่คำนวณได้ลง memberTotals
        sharedMembers.forEach(memId => {
          const rawShare = memberItemShares[memId];
          const roundedShare = Math.round(rawShare * 100) / 100;
          if (roundedShare > 0 && memberTotals[memId]) {
            memberTotals[memId].subtotal += roundedShare;
            const cfg = memberConfig[memId];
            let label = item.name;
            if (cfg.mode === 'latecomer' && cfg.qty < totalQty) {
              label = `${item.name} (ทัน ${cfg.qty} ขวดหลัง • ร่วมหารในโต๊ะ)`;
            } else if (sharedMembers.some(id => memberConfig[id].mode === 'latecomer' && memberConfig[id].qty < totalQty)) {
              label = `${item.name} (ส่วนต้น + ร่วมหารช่วงท้าย)`;
            }
            memberTotals[memId].itemsConsumed.push({
              itemId: item.id,
              name: label,
              share: roundedShare,
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
      itemsConsumed: [],
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
        if (mt.itemsConsumed && mt.itemsConsumed.length > 0) {
          netBalances[mt.memberId].itemsConsumed.push(...mt.itemsConsumed);
        }
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
