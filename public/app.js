const { createApp, ref, reactive, computed, onMounted, watch } = Vue;

createApp({
  setup() {
    // State
    const socket = ref(null);
    const connected = ref(false);
    const currentTab = ref('bills'); // 'bills' | 'scan' | 'summary' | 'members'
    
    // Search & Filter
    const searchQuery = ref('');
    const filterCategory = ref('all'); // 'all' | 'alcohol' | 'food' | 'mixer' | 'slip'
    const quickNewMemberName = ref('');

    // Room & User
    const room = ref(null);
    const summary = ref(null);
    const currentMemberId = ref(localStorage.getItem('my_member_id') || '');
    const currentRoomId = ref('');
    const serverLocalIp = ref('');

    // Creation / Join form
    const createForm = reactive({
      name: 'วงเหล้าคืนนี้ 🍻',
      hostName: 'กูเอง (เจ้าภาพ)',
      hostPromptPay: ''
    });

    const joinForm = reactive({
      roomId: '',
      name: '',
      promptpay: '',
      isJoin: false
    });

    // New Bill Form (Itemized)
    const showNewBillModal = ref(false);
    const newBillForm = reactive({
      title: 'ค่าเหล้าหลังบิลแรก 🍻',
      type: 'alcohol', // 'food' | 'alcohol' | 'late_drinks' | 'mixer' | 'other'
      payerId: '',
      serviceCharge: 0,
      vat: 0,
      discount: 0
    });

    // New Lump-Sum Slip Form (สลิปโอนเงินก้อน)
    const showNewSlipModal = ref(false);
    const slipSearchOrCustomTag = ref('');
    const slipImagePreview = ref('');
    const newSlipForm = reactive({
      title: 'สลิปโอนเงินสั่งเพิ่ม 🧾',
      amount: '',
      payerId: '',
      tags: ['🍺 ค่าเบียร์', '🧊 ค่าน้ำแข็ง'], // Selected tags
      imageUrl: '',
      consumers: []
    });

    const AVAILABLE_SLIP_TAGS = [
      '🍺 ค่าเบียร์',
      '🍻 ค่าเหล้า',
      '🧊 ค่าน้ำแข็ง',
      '🥤 ค่ามิกเซอร์/โซดา/น้ำเปล่า',
      '🍲 ค่าอาหาร/กับแกล้ม',
      '⚡ ค่าเปิดขวด',
      '🍟 เฟรนฟราย/ของทอด',
      '🥢 ข้าวผัด/จานเดียว',
      '🎶 ค่าดนตรี/ห้องคาราโอเกะ'
    ];

    const filteredAvailableSlipTags = computed(() => {
      const q = slipSearchOrCustomTag.value.trim().toLowerCase();
      if (!q) return AVAILABLE_SLIP_TAGS;
      return AVAILABLE_SLIP_TAGS.filter(t => t.toLowerCase().includes(q));
    });

    // New Item Form
    const showNewItemModal = ref(false);
    const activeBillId = ref('');
    const newItemForm = reactive({
      name: '',
      price: '',
      qty: 1,
      category: 'food'
    });

    // Custom Quantity Modal (คนมาทีหลัง ดื่มช่วงท้าย X ขวด หารร่วมกับเพื่อนในโต๊ะ)
    const showCustomQtyModal = ref(false);
    const customQtyTargetBillId = ref('');
    const customQtyTargetItem = ref(null);
    const customQtyNumber = ref(8);
    const customQtyMode = ref('latecomer'); // 'latecomer' (หารร่วมกับเพื่อน) | 'solo' (กินคนเดียว)

    function openCustomQtyModal(billId, item) {
      customQtyTargetBillId.value = billId;
      customQtyTargetItem.value = item;
      const val = item.customConsumers && item.customConsumers[currentMemberId.value];
      if (val) {
        if (typeof val === 'object') {
          customQtyNumber.value = val.qty || 1;
          customQtyMode.value = val.mode || 'latecomer';
        } else {
          customQtyNumber.value = parseInt(val, 10) || 1;
          customQtyMode.value = 'latecomer';
        }
      } else {
        customQtyNumber.value = Math.min(item.qty || 1, 8);
        customQtyMode.value = 'latecomer';
      }
      showCustomQtyModal.value = true;
    }

    function saveCustomQty() {
      if (!customQtyTargetItem.value) return;
      socket.value.emit('set-custom-qty', {
        roomId: currentRoomId.value,
        billId: customQtyTargetBillId.value,
        itemId: customQtyTargetItem.value.id,
        memberId: currentMemberId.value,
        qty: customQtyNumber.value,
        mode: customQtyMode.value
      });
      showCustomQtyModal.value = false;
      const modeText = customQtyMode.value === 'latecomer' ? 'มาร่วมดื่มช่วงท้าย (หารร่วมกับเพื่อนในโต๊ะ)' : 'กินคนเดียว';
      showToast(`ระบุว่าคุณ${modeText} ${customQtyNumber.value} ขวด เรียบร้อย!`, 'success');
    }

    function resetToEqualShare() {
      if (!customQtyTargetItem.value) return;
      socket.value.emit('set-custom-qty', {
        roomId: currentRoomId.value,
        billId: customQtyTargetBillId.value,
        itemId: customQtyTargetItem.value.id,
        memberId: currentMemberId.value,
        qty: 0
      });
      showCustomQtyModal.value = false;
      showToast('เปลี่ยนกลับเป็นหารเต็มเวลาเท่ากับเพื่อนเรียบร้อย!', 'info');
    }

    function getMyCustomConfig(item) {
      if (!item || !item.customConsumers || !currentMemberId.value) return null;
      const val = item.customConsumers[currentMemberId.value];
      if (!val) return null;
      if (typeof val === 'object') return val;
      return { qty: val, mode: 'latecomer' };
    }

    function getMyCustomQty(item) {
      const cfg = getMyCustomConfig(item);
      return cfg ? cfg.qty : 0;
    }

    function resetBillToNomad(billId) {
      if (confirm('คุณต้องการรีเซ็ตบิลนี้กลับเป็นบิลร้าน 13 รายการดั้งเดิม (ลบรายการที่แยกซ้ำ) ใช่ไหม?')) {
        socket.value.emit('reset-bill-items', {
          roomId: currentRoomId.value,
          billId
        });
        showToast('รีเซ็ตบิลกลับเป็น 13 รายการดั้งเดิมเรียบร้อย!', 'success');
      }
    }

    function getDetailedConsumerNames(item) {
      if (!item || !room.value || !room.value.members) return '';
      const validMap = new Map(room.value.members.map(m => [m.id, m.name]));
      const custom = item.customConsumers || {};
      const parts = [];

      for (const [id, val] of Object.entries(custom)) {
        const name = validMap.get(id);
        const q = typeof val === 'object' ? val.qty : val;
        const mode = typeof val === 'object' ? val.mode : 'latecomer';
        if (name && q > 0) {
          if (mode === 'latecomer') {
            parts.push(`${name} (ทัน ${q} ขวดหลัง)`);
          } else {
            parts.push(`${name} (กินคนเดียว ${q} ชิ้น)`);
          }
        }
      }

      const general = (item.consumers || []).filter(id => validMap.has(id) && !custom[id]);
      const generalNames = general.map(id => validMap.get(id)).filter(Boolean);
      if (generalNames.length > 0) {
        parts.push(generalNames.join(', '));
      }

      return parts.join(', ');
    }

    function getItemMemberShare(billId, itemId, memberId) {
      if (!summary.value || !summary.value.billCalculations) return 0;
      const bc = summary.value.billCalculations.find(b => b.billId === billId);
      if (!bc || !bc.memberTotals || !bc.memberTotals[memberId]) return 0;
      const found = bc.memberTotals[memberId].itemsConsumed.find(i => i.itemId === itemId);
      return found ? found.share : 0;
    }

    function getMemberConsumedItems(memberId) {
      if (!summary.value || !summary.value.netBalances || !summary.value.netBalances[memberId]) return [];
      return summary.value.netBalances[memberId].itemsConsumed || [];
    }

    function getMemberTotal(memberId) {
      if (!summary.value || !summary.value.netBalances || !summary.value.netBalances[memberId]) return 0;
      return summary.value.netBalances[memberId].consumedTotal || 0;
    }

    function calculateLatecomerPreviewShare(item, latecomerQty) {
      if (!item) return 0;
      const totalQty = parseInt(item.qty, 10) || 1;
      const totalPrice = parseFloat(item.price) || 0;
      const unitPrice = totalPrice / totalQty;
      const q = Math.min(totalQty, Math.max(1, latecomerQty || 1));
      
      // จำนวนคนดื่มรายการนี้
      const numDrinkers = (item.consumers && item.consumers.length > 0) ? item.consumers.length : (room.value?.members?.length || 1);
      // ส่วนของ 8 ขวดหลัง หารด้วยจำนวนคนในโต๊ะที่ร่วมดื่ม
      return Math.round((q * unitPrice / numDrinkers) * 100) / 100;
    }

    // Split Item Form (สำหรับคนมาทีหลัง หรือคนที่กินแค่ไม่กี่ขวด)
    const showSplitModal = ref(false);
    const splitMode = ref('personal'); // 'personal' | 'period'
    const splitTargetBillId = ref('');
    const splitTargetItem = ref(null);
    const splitQtyInput = ref(1);
    const splitName1Input = ref('');
    const splitName2Input = ref('');

    function openSplitItemModal(billId, item, defaultMode = 'personal') {
      splitTargetBillId.value = billId;
      splitTargetItem.value = item;
      splitMode.value = defaultMode;
      const totalQty = parseInt(item.qty, 10) || 1;
      splitQtyInput.value = defaultMode === 'personal' ? 1 : Math.max(1, Math.floor(totalQty / 2));
      updateSplitNames();
      showSplitModal.value = true;
    }

    function updateSplitNames() {
      if (!splitTargetItem.value) return;
      const item = splitTargetItem.value;
      const myName = currentMember.value?.name || 'ของฉัน';
      if (splitMode.value === 'personal') {
        splitName1Input.value = `${item.name} (ส่วนที่เหลือในโต๊ะ)`;
        splitName2Input.value = `${item.name} (ของ ${myName} ${splitQtyInput.value} ชิ้น)`;
      } else {
        splitName1Input.value = `${item.name} (รอบแรก ก่อนเพื่อนมา)`;
        splitName2Input.value = `${item.name} (รอบสอง เพื่อนมาทีหลังร่วมดื่ม)`;
      }
    }

    function submitSplitItem() {
      if (!splitTargetItem.value) return;
      updateSplitNames();
      socket.value.emit('split-item', {
        roomId: currentRoomId.value,
        billId: splitTargetBillId.value,
        itemId: splitTargetItem.value.id,
        splitQty: splitQtyInput.value,
        splitName1: splitName1Input.value,
        splitName2: splitName2Input.value,
        consumerForSplit: splitMode.value === 'personal' ? currentMemberId.value : null
      });
      showSplitModal.value = false;
      if (splitMode.value === 'personal') {
        showToast(`แยกขวดของ ${currentMember.value?.name || 'คุณ'} เรียบร้อย! จ่ายเฉพาะส่วนที่กินจริง 🍻`, 'success');
      } else {
        showToast('แยกช่วงสำหรับคนมาทีหลังเรียบร้อย!', 'success');
      }
    }

    function claimItemAlone(billId, item) {
      if (!currentMemberId.value) {
        showToast('กรุณาเลือกชื่อของคุณก่อนครับ', 'error');
        return;
      }
      socket.value.emit('claim-alone', {
        roomId: currentRoomId.value,
        billId,
        itemId: item.id,
        memberId: currentMemberId.value
      });
      showSplitModal.value = false;
      showToast(`จานนี้ ${currentMember.value?.name || 'คุณ'} กินคนเดียว ไม่ต้องหารกับใคร!`, 'success');
    }

    // OCR / Scan Receipt Form
    const isScanning = ref(false);
    const scanStep = ref('upload'); // 'upload' | 'preview'
    const scanReceiptTargetBillId = ref('new');
    const scanNewBillTitle = ref('บิลสแกนใบเสร็จ 🧾');
    const scanNewBillType = ref('food');
    const scanNewBillPayerId = ref('');
    const parsedOcrItems = ref([]);
    const receiptImagePreview = ref('');
    const manualReceiptText = ref('');

    // QR Modal
    const showQrModal = ref(false);
    const qrData = reactive({
      title: '',
      account: '',
      amount: 0,
      qrUrl: '',
      toName: ''
    });

    // Toast
    const toast = reactive({
      show: false,
      message: '',
      type: 'info'
    });

    function showToast(message, type = 'info') {
      toast.message = message;
      toast.type = type;
      toast.show = true;
      setTimeout(() => {
        toast.show = false;
      }, 3000);
    }

    // Initialize Socket.io
    onMounted(() => {
      socket.value = io();

      fetch('/api/server-info').then(r => r.json()).then(data => {
        if (data.localIp && data.localIp !== 'localhost') {
          serverLocalIp.value = data.localIp;
        }
      }).catch(() => {});

      socket.value.on('connect', () => {
        connected.value = true;
        console.log('Connected to socket server');

        const urlParams = new URLSearchParams(window.location.search);
        const roomFromUrl = urlParams.get('room');
        if (roomFromUrl) {
          joinForm.roomId = roomFromUrl.toUpperCase();
          joinForm.isJoin = true;
          currentRoomId.value = roomFromUrl.toUpperCase();
          fetchRoom(currentRoomId.value);
        }
      });

      socket.value.on('room-updated', (data) => {
        room.value = data.room;
        summary.value = data.summary;

        if (!currentMemberId.value && room.value.members.length > 0) {
          currentMemberId.value = room.value.members[0].id;
          localStorage.setItem('my_member_id', currentMemberId.value);
        }
      });

      socket.value.on('disconnect', () => {
        connected.value = false;
      });
    });

    const currentMember = computed(() => {
      if (!room.value || !room.value.members) return null;
      return room.value.members.find(m => m.id === currentMemberId.value) || null;
    });

    // Filtered Bills & Items
    const filteredBills = computed(() => {
      if (!room.value || !room.value.bills) return [];
      const q = searchQuery.value.trim().toLowerCase();
      const cat = filterCategory.value;

      return room.value.bills.map(b => {
        // If it's a lump-sum slip
        if (b.isSlip) {
          const matchTag = (b.slipTags || []).some(t => t.toLowerCase().includes(q));
          const matchTitle = (b.title || '').toLowerCase().includes(q);
          const matchPayer = getPayerName(b.payerId).toLowerCase().includes(q);
          const matchesQuery = !q || matchTag || matchTitle || matchPayer;
          const matchesCat = cat === 'all' || cat === 'slip' || 
            (cat === 'alcohol' && (b.slipTags || []).some(t => t.includes('เหล้า') || t.includes('เบียร์'))) ||
            (cat === 'mixer' && (b.slipTags || []).some(t => t.includes('น้ำแข็ง') || t.includes('มิกเซอร์'))) ||
            (cat === 'food' && (b.slipTags || []).some(t => t.includes('อาหาร') || t.includes('กับแกล้ม')));

          return (matchesQuery && matchesCat) ? b : null;
        }

        // Itemized bill
        let filteredItems = (b.items || []).filter(item => {
          const matchName = item.name.toLowerCase().includes(q);
          const matchCat = cat === 'all' || item.category === cat;
          return (!q || matchName) && matchCat;
        });

        // Also if bill title matches query, keep items
        if (q && b.title.toLowerCase().includes(q) && cat === 'all') {
          filteredItems = b.items;
        }

        if (filteredItems.length > 0 || (!q && cat === 'all')) {
          return {
            ...b,
            items: filteredItems
          };
        }
        return null;
      }).filter(Boolean);
    });

    // Create Room
    async function handleCreateRoom() {
      if (!createForm.name || !createForm.hostName) {
        showToast('กรุณากรอกชื่อโต๊ะและชื่อของคุณ', 'error');
        return;
      }

      try {
        const res = await fetch('/api/room', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(createForm)
        });
        const data = await res.json();
        if (data.roomId) {
          currentRoomId.value = data.roomId;
          currentMemberId.value = data.hostId;
          localStorage.setItem('my_member_id', data.hostId);

          window.history.pushState({}, '', `?room=${data.roomId}`);

          socket.value.emit('join-room', {
            roomId: data.roomId,
            member: { id: data.hostId, name: createForm.hostName, promptpay: createForm.hostPromptPay }
          });

          room.value = data.room;
          showToast(`เปิดโต๊ะเรียบร้อย! รหัสห้อง: ${data.roomId}`, 'success');
        }
      } catch (err) {
        showToast('เกิดข้อผิดพลาดในการสร้างห้อง: ' + err.message, 'error');
      }
    }

    // Join Room
    async function handleJoinRoom() {
      if (!joinForm.roomId || !joinForm.name) {
        showToast('กรุณากรอกรหัสห้องและชื่อของคุณ', 'error');
        return;
      }

      const roomId = joinForm.roomId.trim().toUpperCase();
      try {
        const res = await fetch(`/api/room/${roomId}`);
        if (!res.ok) {
          showToast('ไม่พบห้องนี้ กรุณาตรวจสอบรหัสห้อง', 'error');
          return;
        }
        const data = await res.json();
        room.value = data.room;
        summary.value = data.summary;
        currentRoomId.value = roomId;

        window.history.pushState({}, '', `?room=${roomId}`);

        let existingMem = room.value.members.find(m => m.name.toLowerCase() === joinForm.name.trim().toLowerCase());
        const memId = existingMem ? existingMem.id : 'mem_' + Math.random().toString(36).substr(2, 8);

        currentMemberId.value = memId;
        localStorage.setItem('my_member_id', memId);

        socket.value.emit('join-room', {
          roomId: roomId,
          member: { id: memId, name: joinForm.name.trim(), promptpay: joinForm.promptpay }
        });

        showToast(`ยินดีต้อนรับเข้าสู่ ${room.value.name}! 🍻`, 'success');
      } catch (err) {
        showToast('เกิดข้อผิดพลาดในการเข้าห้อง', 'error');
      }
    }

    // Load Demo Room
    async function loadDemoRoom() {
      createForm.name = 'วงเหล้าวันศุกร์หรรษา 🍻';
      createForm.hostName = 'พี่บอย (คนจ่ายบิลแรก)';
      createForm.hostPromptPay = '0812345678';
      await handleCreateRoom();

      setTimeout(() => {
        const friends = [
          { name: 'ไอ้นัท (สายดื่ม)', avatar: '🍻', promptpay: '0899999999' },
          { name: 'เจน (ไม่ดื่มเหล้า)', avatar: '🥤', promptpay: '' },
          { name: 'ตั้ม (มาทีหลังรอบสอง)', avatar: '⏰', promptpay: '' }
        ];

        friends.forEach(f => {
          socket.value.emit('add-member', {
            roomId: currentRoomId.value,
            name: f.name,
            avatar: f.avatar,
            promptpay: f.promptpay
          });
        });

        setTimeout(() => {
          const hostId = currentMemberId.value;
          const mems = room.value.members;
          const nutId = mems.find(m => m.name.includes('นัท'))?.id || hostId;
          const janeId = mems.find(m => m.name.includes('เจน'))?.id || hostId;
          const tumId = mems.find(m => m.name.includes('ตั้ม'))?.id || hostId;

          // Bill 1: อาหารและเปิดโต๊ะ
          socket.value.emit('add-bill', {
            roomId: currentRoomId.value,
            bill: {
              title: 'บิล 1: อาหารและเปิดโต๊ะหัวค่ำ 🍽️',
              type: 'food',
              payerId: hostId,
              items: [
                { id: 'i1', name: 'ข้าวผัดปูจานใหญ่', price: 250, qty: 1, category: 'food', consumers: [hostId, nutId, janeId] },
                { id: 'i2', name: 'ต้มยำรวมมิตรหม้อไฟ', price: 280, qty: 1, category: 'food', consumers: [hostId, nutId, janeId] },
                { id: 'i3', name: 'เอ็นไก่ทอด', price: 120, qty: 2, category: 'food', consumers: [hostId, nutId] },
                { id: 'i4', name: 'แสงโสม 1 กลม (เปิดโต๊ะ)', price: 420, qty: 1, category: 'alcohol', consumers: [hostId, nutId] },
                { id: 'i5', name: 'มิกเซอร์ โซดา+น้ำแข็ง', price: 150, qty: 1, category: 'mixer', consumers: [hostId, nutId] },
                { id: 'i6', name: 'โค้กกระป๋อง (ของเจน)', price: 35, qty: 2, category: 'mixer', consumers: [janeId] }
              ]
            }
          });

          // Bill 2: สลิปโอนค่าเหล้า+น้ำแข็งสั่งเพิ่มรอบสอง (ไอ้นัทโอนให้ร้าน)
          setTimeout(() => {
            socket.value.emit('add-bill', {
              roomId: currentRoomId.value,
              bill: {
                title: 'สลิปโอน: ค่าเบียร์ทาวเวอร์ + น้ำแข็ง (รอบดึก) 🍻',
                type: 'slip',
                isSlip: true,
                payerId: nutId,
                slipAmount: 550,
                slipTags: ['🍺 ค่าเบียร์', '🧊 ค่าน้ำแข็ง'],
                slipConsumers: [hostId, nutId, tumId] // ตั้มมาพอดี ได้กินด้วย! เจนไม่เกี่ยว
              }
            });
          }, 400);

        }, 400);

      }, 500);
    }

    async function fetchRoom(id) {
      try {
        const res = await fetch(`/api/room/${id}`);
        if (res.ok) {
          const data = await res.json();
          room.value = data.room;
          summary.value = data.summary;
          socket.value.emit('join-room', {
            roomId: id,
            member: currentMember.value || null
          });
        }
      } catch (err) {
        console.error('Fetch room error:', err);
      }
    }

    function switchMember(id) {
      currentMemberId.value = id;
      localStorage.setItem('my_member_id', id);
      showToast(`เปลี่ยนเป็น: ${currentMember.value?.name}`, 'info');
    }

    // Toggle Item Consume
    function toggleItemConsume(billId, itemId, memberId) {
      if (!memberId) memberId = currentMemberId.value;
      if (!memberId) {
        showToast('กรุณาเลือกตัวคุณเองก่อนติ๊ก', 'error');
        return;
      }

      socket.value.emit('toggle-consume', {
        roomId: currentRoomId.value,
        billId,
        itemId,
        memberId
      });
    }

    function toggleAllConsumers(billId, itemId) {
      socket.value.emit('toggle-all-consumers-for-item', {
        roomId: currentRoomId.value,
        billId,
        itemId
      });
    }

    // Toggle Lump-sum Slip Consumer
    function toggleSlipConsume(billId, memberId) {
      if (!memberId) memberId = currentMemberId.value;
      socket.value.emit('toggle-slip-consume', {
        roomId: currentRoomId.value,
        billId,
        memberId
      });
    }

    function toggleAllSlipConsumers(billId) {
      socket.value.emit('toggle-all-slip-consumers', {
        roomId: currentRoomId.value,
        billId
      });
    }

    // Add Member
    function addNewMemberPrompt() {
      const name = prompt('กรอกชื่อเพื่อนที่มาร่วมวง:');
      if (name && name.trim()) {
        socket.value.emit('add-member', {
          roomId: currentRoomId.value,
          name: name.trim(),
          avatar: '🍻',
          promptpay: ''
        });
        showToast(`เพิ่ม ${name} เข้าโต๊ะแล้ว!`, 'success');
      }
    }

    // Quick Join Room from Top Banner
    function quickJoinCurrentRoom() {
      if (!quickNewMemberName.value || !quickNewMemberName.value.trim()) {
        showToast('กรุณากรอกชื่อของคุณก่อนครับ', 'error');
        return;
      }
      const name = quickNewMemberName.value.trim();
      const existing = room.value.members.find(m => m.name.toLowerCase() === name.toLowerCase());
      if (existing) {
        currentMemberId.value = existing.id;
        localStorage.setItem('my_member_id', existing.id);
        showToast(`สลับเป็น ${existing.name} เรียบร้อย! ติ๊กของกินได้เลย`, 'success');
      } else {
        const memId = 'mem_' + Math.random().toString(36).substr(2, 8);
        currentMemberId.value = memId;
        localStorage.setItem('my_member_id', memId);
        socket.value.emit('add-member', {
          roomId: currentRoomId.value,
          name: name,
          avatar: '🍺',
          promptpay: ''
        });
        showToast(`ยินดีต้อนรับ ${name}! แตะติ๊กของที่คุณกินได้เลยครับ 🍻`, 'success');
      }
      quickNewMemberName.value = '';
    }

    // เพิ่มเพื่อนและติ๊กกินรายการนี้ทันที
    function quickAddFriendAndConsume(billId, itemId) {
      const name = prompt('กรอกชื่อเพื่อนที่กินรายการนี้ (เช่น บอย, ตั้ม, นัท):');
      if (!name || !name.trim()) return;
      const cleanName = name.trim();
      
      let member = room.value.members.find(m => m.name.toLowerCase() === cleanName.toLowerCase());
      let memberId = member ? member.id : null;
      
      if (!memberId) {
        memberId = 'mem_' + Math.random().toString(36).substr(2, 8);
        socket.value.emit('add-member', {
          roomId: currentRoomId.value,
          name: cleanName,
          avatar: '🍺',
          promptpay: ''
        });
      }
      
      setTimeout(() => {
        socket.value.emit('toggle-consume', {
          roomId: currentRoomId.value,
          billId,
          itemId,
          memberId
        });
      }, 100);
      
      showToast(`เพิ่ม ${cleanName} และติ๊กกินรายการนี้เรียบร้อย!`, 'success');
    }

    // เพิ่มเพื่อนและติ๊กเข้าสลิปทันที
    function quickAddFriendToSlip(billId) {
      const name = prompt('กรอกชื่อเพื่อนที่ร่วมหารสลิปนี้ (เช่น บอย, ตั้ม, นัท):');
      if (!name || !name.trim()) return;
      const cleanName = name.trim();
      
      let member = room.value.members.find(m => m.name.toLowerCase() === cleanName.toLowerCase());
      let memberId = member ? member.id : null;
      
      if (!memberId) {
        memberId = 'mem_' + Math.random().toString(36).substr(2, 8);
        socket.value.emit('add-member', {
          roomId: currentRoomId.value,
          name: cleanName,
          avatar: '🍺',
          promptpay: ''
        });
      }
      
      setTimeout(() => {
        socket.value.emit('toggle-slip-consume', {
          roomId: currentRoomId.value,
          billId,
          memberId
        });
      }, 100);
      
      showToast(`เพิ่ม ${cleanName} เข้าสลิปนี้เรียบร้อย!`, 'success');
    }

    // Quick 1-click Photo-to-Bill (ถ่ายรูปบิลแล้วแกะเมนูสร้างบิลทันที)
    async function handleQuickPhotoBill(event) {
      const file = event.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('receipt', file);

      isScanning.value = true;
      showToast('🔍 กำลังอ่านและแกะเมนูจากรูปบิล...', 'info');

      try {
        const res = await fetch('/api/ocr/receipt', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        isScanning.value = false;

        if (data.items && data.items.length > 0) {
          const billTitle = `บิลร้านอาหาร (${data.items.length} รายการ) 🧾`;
          
          socket.value.emit('add-bill', {
            roomId: currentRoomId.value,
            bill: {
              title: billTitle,
              type: 'food',
              payerId: currentMemberId.value || room.value.members[0]?.id,
              receiptImage: data.imageUrl,
              items: data.items.map(i => ({
                ...i,
                consumers: [] // เริ่มต้นแสดงราคาเต็มไว้ก่อน พอคนติ๊กถึงจะเริ่มหารตามจำนวนคน
              }))
            }
          });

          showToast(`🎉 แกะได้ ${data.items.length} รายการแล้ว! ใครกินอันไหนเริ่มแตะติ๊กได้เลย`, 'success');
        } else {
          showToast('อ่านตัวหนังสือในบิลไม่ชัดเจน ลองใช้แท็บสแกนหรือพิมพ์รายการแทนครับ', 'info');
          manualReceiptText.value = data.extractedText || '';
          currentTab.value = 'scan';
          scanStep.value = 'preview';
        }
      } catch (err) {
        isScanning.value = false;
        showToast('เกิดข้อผิดพลาดในการอ่านบิล: ' + err.message, 'error');
      }
    }

    // ถ่ายรูปบิลเพิ่มเข้าในบิลที่มีอยู่แล้ว
    async function handleQuickPhotoToExistingBill(billId, event) {
      const file = event.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('receipt', file);

      isScanning.value = true;
      showToast('🔍 กำลังอ่านและเพิ่มเมนูเข้าในบิลนี้...', 'info');

      try {
        const res = await fetch('/api/ocr/receipt', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        isScanning.value = false;

        if (data.items && data.items.length > 0) {
          const allMembers = room.value.members.map(m => m.id);
          data.items.forEach(item => {
            socket.value.emit('add-item', {
              roomId: currentRoomId.value,
              billId: billId,
              item: {
                ...item,
                consumers: allMembers
              }
            });
          });
          showToast(`เพิ่ม ${data.items.length} รายการเข้าในบิลนี้แล้ว!`, 'success');
        } else {
          showToast('ไม่พบรายการชัดเจนในรูปภาพ', 'info');
        }
      } catch (err) {
        isScanning.value = false;
        showToast('เกิดข้อผิดพลาด: ' + err.message, 'error');
      }
    }

    function openNewBillModal() {
      newBillForm.title = room.value.bills.length === 0 ? 'บิล 1: อาหารและเปิดโต๊ะ 🍽️' : `บิล ${room.value.bills.length + 1}: บิลอาหารสั่งเพิ่ม 🍲`;
      newBillForm.type = 'food';
      newBillForm.payerId = currentMemberId.value || (room.value.members[0]?.id || '');
      showNewBillModal.value = true;
    }

    function submitNewBill() {
      if (!newBillForm.title) {
        showToast('กรุณากรอกชื่อบิล', 'error');
        return;
      }

      socket.value.emit('add-bill', {
        roomId: currentRoomId.value,
        bill: {
          title: newBillForm.title,
          type: newBillForm.type,
          payerId: newBillForm.payerId,
          serviceCharge: newBillForm.serviceCharge,
          vat: newBillForm.vat,
          discount: newBillForm.discount,
          items: []
        }
      });

      showNewBillModal.value = false;
      showToast('เพิ่มบิลใหม่เรียบร้อย!', 'success');
    }

    // Add Lump-Sum Slip Modal
    function openNewSlipModal() {
      newSlipForm.title = 'สลิปโอนเงินสั่งเพิ่ม 🧾';
      newSlipForm.amount = '';
      newSlipForm.payerId = currentMemberId.value || (room.value.members[0]?.id || '');
      newSlipForm.tags = ['🍺 ค่าเบียร์', '🧊 ค่าน้ำแข็ง'];
      newSlipForm.imageUrl = '';
      slipImagePreview.value = '';
      slipSearchOrCustomTag.value = '';
      newSlipForm.consumers = room.value.members.map(m => m.id);
      showNewSlipModal.value = true;
    }

    function toggleSlipTag(tag) {
      const idx = newSlipForm.tags.indexOf(tag);
      if (idx > -1) {
        newSlipForm.tags.splice(idx, 1);
      } else {
        newSlipForm.tags.push(tag);
      }
    }

    function addCustomSlipTag() {
      const tag = slipSearchOrCustomTag.value.trim();
      if (tag && !newSlipForm.tags.includes(tag)) {
        newSlipForm.tags.push(tag);
        slipSearchOrCustomTag.value = '';
      }
    }

    async function handleSlipImageUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      slipImagePreview.value = URL.createObjectURL(file);
      const formData = new FormData();
      formData.append('slip', file);

      try {
        const res = await fetch('/api/upload-slip', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        if (data.imageUrl) {
          newSlipForm.imageUrl = data.imageUrl;
          showToast('แนบรูปสลิปเรียบร้อย! ระบุยอดเงินและสิ่งที่จ่ายได้เลย', 'success');
        }
      } catch (err) {
        showToast('อัปโหลดรูปสลิปไม่สำเร็จ: ' + err.message, 'error');
      }
    }

    function submitNewSlip() {
      if (!newSlipForm.amount || parseFloat(newSlipForm.amount) <= 0) {
        showToast('กรุณาระบุยอดเงินในสลิป', 'error');
        return;
      }

      // If user typed something in search tag but forgot to press add
      if (slipSearchOrCustomTag.value.trim() && !newSlipForm.tags.includes(slipSearchOrCustomTag.value.trim())) {
        newSlipForm.tags.push(slipSearchOrCustomTag.value.trim());
      }

      const tags = newSlipForm.tags.length > 0 ? newSlipForm.tags : ['สลิปโอนเงิน'];

      socket.value.emit('add-bill', {
        roomId: currentRoomId.value,
        bill: {
          title: newSlipForm.title || `สลิปจ่าย: ${tags.join(', ')}`,
          type: 'slip',
          isSlip: true,
          payerId: newSlipForm.payerId,
          slipAmount: parseFloat(newSlipForm.amount),
          slipTags: tags,
          receiptImage: newSlipForm.imageUrl || null,
          slipConsumers: newSlipForm.consumers.length > 0 ? newSlipForm.consumers : room.value.members.map(m => m.id)
        }
      });

      showNewSlipModal.value = false;
      showToast('บันทึกสลิปโอนเงินเรียบร้อย!', 'success');
    }

    function deleteBill(billId) {
      if (confirm('คุณแน่ใจว่าต้องการลบบิลนี้ใช่ไหม?')) {
        socket.value.emit('delete-bill', {
          roomId: currentRoomId.value,
          billId
        });
      }
    }

    // Add Item
    function openNewItemModal(billId) {
      activeBillId.value = billId;
      newItemForm.name = '';
      newItemForm.price = '';
      newItemForm.qty = 1;
      newItemForm.category = 'food';
      showNewItemModal.value = true;
    }

    function submitNewItem() {
      if (!newItemForm.name || !newItemForm.price) {
        showToast('กรุณากรอกชื่อและราคา', 'error');
        return;
      }

      const consumers = room.value.members.map(m => m.id);

      socket.value.emit('add-item', {
        roomId: currentRoomId.value,
        billId: activeBillId.value,
        item: {
          name: newItemForm.name,
          price: parseFloat(newItemForm.price),
          qty: parseInt(newItemForm.qty, 10) || 1,
          category: newItemForm.category,
          consumers: consumers
        }
      });

      showNewItemModal.value = false;
      showToast('เพิ่มรายการเรียบร้อย!', 'success');
    }

    function deleteItem(billId, itemId) {
      socket.value.emit('delete-item', {
        roomId: currentRoomId.value,
        billId,
        itemId
      });
    }

    // OCR / Receipt Scanner
    async function handleReceiptUpload(event) {
      const file = event.target.files[0];
      if (!file) return;

      const formData = new FormData();
      formData.append('receipt', file);

      isScanning.value = true;
      receiptImagePreview.value = URL.createObjectURL(file);

      try {
        const res = await fetch('/api/ocr/receipt', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();
        isScanning.value = false;

        if (data.items && data.items.length > 0) {
          parsedOcrItems.value = data.items.map(i => ({
            ...i,
            selected: true,
            consumers: room.value.members.map(m => m.id)
          }));
          scanStep.value = 'preview';
          showToast(`แกะรายการได้ ${data.items.length} รายการ ตรวจสอบได้เลย!`, 'success');
        } else {
          showToast('ไม่สามารถอ่านรายการชัดเจน ลองพิมพ์หรือแก้ไขเองได้เลยครับ', 'info');
          manualReceiptText.value = data.extractedText || '';
          scanStep.value = 'preview';
        }
      } catch (err) {
        isScanning.value = false;
        showToast('การสแกนผิดพลาด: ' + err.message, 'error');
      }
    }

    async function handleParseManualText() {
      if (!manualReceiptText.value) return;
      try {
        const res = await fetch('/api/parse-text', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: manualReceiptText.value })
        });
        const data = await res.json();
        parsedOcrItems.value = (data.items || []).map(i => ({
          ...i,
          selected: true,
          consumers: room.value.members.map(m => m.id)
        }));
        scanStep.value = 'preview';
        showToast(`แยกได้ ${parsedOcrItems.value.length} รายการ`, 'success');
      } catch (err) {
        showToast('เกิดข้อผิดพลาดในการแปลงข้อความ', 'error');
      }
    }

    function addManualItemToOcrList() {
      parsedOcrItems.value.push({
        id: 'item_' + Math.random().toString(36).substr(2, 9),
        name: 'รายการใหม่',
        price: 100,
        qty: 1,
        category: 'food',
        selected: true,
        consumers: room.value.members.map(m => m.id)
      });
    }

    function removeOcrItem(index) {
      parsedOcrItems.value.splice(index, 1);
    }

    function applyOcrItemsToBill() {
      const selectedItems = parsedOcrItems.value.filter(i => i.selected);
      if (selectedItems.length === 0) {
        showToast('ไม่มีรายการที่เลือก', 'error');
        return;
      }

      if (scanReceiptTargetBillId.value === 'new') {
        socket.value.emit('add-bill', {
          roomId: currentRoomId.value,
          bill: {
            title: scanNewBillTitle.value || 'บิลจากการสแกน 🧾',
            type: scanNewBillType.value,
            payerId: scanNewBillPayerId.value || currentMemberId.value,
            items: selectedItems
          }
        });
      } else {
        selectedItems.forEach(item => {
          socket.value.emit('add-item', {
            roomId: currentRoomId.value,
            billId: scanReceiptTargetBillId.value,
            item: item
          });
        });
      }

      currentTab.value = 'bills';
      scanStep.value = 'upload';
      parsedOcrItems.value = [];
      showToast('นำรายการเข้าบิลเรียบร้อยแล้ว!', 'success');
    }

    // PromptPay QR Code
    async function openPromptPayQr(account, amount, toName) {
      if (!account) {
        showToast('คนรับเงินยังไม่ได้ระบุเลขพร้อมเพย์ สามารถแจ้งเลขในไลน์ได้ครับ', 'info');
        return;
      }

      try {
        const res = await fetch(`/api/promptpay-qr?account=${encodeURIComponent(account)}&amount=${amount}`);
        const data = await res.json();
        qrData.account = account;
        qrData.amount = amount;
        qrData.qrUrl = data.qrDataUrl;
        qrData.toName = toName;
        showQrModal.value = true;
      } catch (err) {
        showToast('ไม่สามารถสร้าง QR Code ได้: ' + err.message, 'error');
      }
    }

    function toggleTransferPaid(transferKey) {
      socket.value.emit('toggle-transfer-paid', {
        roomId: currentRoomId.value,
        transferKey
      });
    }

    function getShareableUrl() {
      if (serverLocalIp.value && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
        return `http://${serverLocalIp.value}:3000/?room=${currentRoomId.value}`;
      }
      return `${window.location.origin}?room=${currentRoomId.value}`;
    }

    function copyShareLink() {
      const link = getShareableUrl();
      navigator.clipboard.writeText(link).then(() => {
        showToast('คัดลอกลิงก์ห้องแล้ว! ส่งเข้าไลน์กลุ่มให้เพื่อนแตะเข้าในมือถือได้เลย', 'success');
      }).catch(() => {
        prompt('ก๊อปปี้ลิงก์นี้ส่งให้เพื่อน:', link);
      });
    }

    // Generate Text Summary for LINE Chat
    function copyLineSummary() {
      if (!room.value || !summary.value) return;

      const link = getShareableUrl();
      let text = `🍻 สรุปยอดหารเงิน: ${room.value.name}\n`;
      text += `📌 ลิงก์ห้อง (แตะในมือถือได้เลย): ${link}\n`;
      text += `🔑 รหัสห้อง: ${currentRoomId.value}\n`;
      text += `--------------------------------\n`;

      // Transfers
      if (summary.value.directTransfers && summary.value.directTransfers.length > 0) {
        text += `💸 ยอดที่ต้องโอน:\n`;
        summary.value.directTransfers.forEach(t => {
          const status = t.isPaid ? ' [✅โอนแล้ว]' : ' [⏳ยังไม่โอน]';
          text += `• ${t.fromName} ➔ โอนให้ ${t.toName}: ${formatMoney(t.amount)} บ. (${t.billTitle})${status}\n`;
        });
      } else {
        text += `ทุกคนเคลียร์ยอดเรียบร้อย!\n`;
      }

      text += `--------------------------------\n`;
      text += `📱 กดเข้าลิงก์เพื่อดูรายละเอียด ติ๊กของกิน และสแกน PromptPay QR ได้เลย!`;

      navigator.clipboard.writeText(text).then(() => {
        showToast('คัดลอกข้อความสรุปแล้ว! วางส่งในแชทกลุ่มได้เลย 💬', 'success');
      }).catch(() => {
        prompt('ก๊อปปี้ข้อความนี้ส่งเข้าไลน์กลุ่ม:', text);
      });
    }

    function getPayerName(payerId) {
      if (!payerId) return 'ไม่ระบุ';
      const m = room.value?.members.find(x => x.id === payerId);
      if (m) return m.name;
      if (payerId === currentMemberId.value) return 'คุณ';
      return 'เพื่อนร่วมวง';
    }

    // คำนวณยอดรวมของบิลนี้
    function getBillTotal(b) {
      if (b.isSlip) return parseFloat(b.slipAmount) || 0;
      let sum = 0;
      (b.items || []).forEach(i => {
        sum += parseFloat(i.price) || 0;
      });
      return sum;
    }

    // กรองเฉพาะรายชื่อสมาชิกที่มีอยู่จริงในห้อง
    function validConsumers(item) {
      if (!room.value || !room.value.members || !item || !item.consumers) return [];
      const validIds = new Set(room.value.members.map(m => m.id));
      return item.consumers.filter(id => validIds.has(id));
    }

    // แปลง IDs คนกินเป็นข้อความชื่อ เช่น "นานะ, ติ๊ก" โดยไม่มีคำว่าไม่ระบุ
    function getConsumerNames(consumerIds) {
      if (!consumerIds || !room.value || !room.value.members) return '';
      const validMap = new Map(room.value.members.map(m => [m.id, m.name]));
      const names = consumerIds.map(id => validMap.get(id)).filter(Boolean);
      return names.join(', ');
    }

    function isConsumedByMe(item) {
      if (!item || !item.consumers || !currentMemberId.value) return false;
      return item.consumers.includes(currentMemberId.value);
    }

    function isSlipConsumedByMe(bill) {
      if (!bill || !bill.slipConsumers || !currentMemberId.value) return false;
      return bill.slipConsumers.includes(currentMemberId.value);
    }

    // คำนวณว่าคนนี้กินในบิลนี้ไปกี่บาท
    function getMemberBillShare(b, memberId) {
      if (!summary.value || !summary.value.billCalculations) return 0;
      const bc = summary.value.billCalculations.find(x => x.billId === b.id);
      if (bc && bc.memberTotals && bc.memberTotals[memberId]) {
        return bc.memberTotals[memberId].total || 0;
      }
      return 0;
    }

    function formatMoney(num) {
      return (Number(num) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    return {
      connected,
      currentTab,
      searchQuery,
      filterCategory,
      quickNewMemberName,
      filteredBills,
      room,
      summary,
      currentMemberId,
      currentMember,
      currentRoomId,
      createForm,
      joinForm,
      showNewBillModal,
      newBillForm,
      showNewSlipModal,
      newSlipForm,
      slipSearchOrCustomTag,
      slipImagePreview,
      AVAILABLE_SLIP_TAGS,
      filteredAvailableSlipTags,
      showNewItemModal,
      newItemForm,
      activeBillId,
      showSplitModal,
      splitMode,
      splitTargetItem,
      splitQtyInput,
      splitName1Input,
      splitName2Input,
      showCustomQtyModal,
      customQtyTargetItem,
      customQtyNumber,
      customQtyMode,
      openCustomQtyModal,
      saveCustomQty,
      resetToEqualShare,
      getMyCustomConfig,
      getMyCustomQty,
      resetBillToNomad,
      getDetailedConsumerNames,
      getItemMemberShare,
      getMemberConsumedItems,
      getMemberTotal,
      calculateLatecomerPreviewShare,
      openSplitItemModal,
      updateSplitNames,
      submitSplitItem,
      claimItemAlone,
      isScanning,
      scanStep,
      scanReceiptTargetBillId,
      scanNewBillTitle,
      scanNewBillType,
      scanNewBillPayerId,
      parsedOcrItems,
      receiptImagePreview,
      manualReceiptText,
      showQrModal,
      qrData,
      toast,
      handleCreateRoom,
      handleJoinRoom,
      loadDemoRoom,
      switchMember,
      toggleItemConsume,
      toggleAllConsumers,
      toggleSlipConsume,
      toggleAllSlipConsumers,
      addNewMemberPrompt,
      openNewBillModal,
      submitNewBill,
      openNewSlipModal,
      toggleSlipTag,
      addCustomSlipTag,
      handleSlipImageUpload,
      submitNewSlip,
      deleteBill,
      openNewItemModal,
      submitNewItem,
      deleteItem,
      handleReceiptUpload,
      handleParseManualText,
      addManualItemToOcrList,
      removeOcrItem,
      applyOcrItemsToBill,
      openPromptPayQr,
      toggleTransferPaid,
      copyShareLink,
      copyLineSummary,
      handleQuickPhotoBill,
      handleQuickPhotoToExistingBill,
      quickJoinCurrentRoom,
      quickAddFriendAndConsume,
      quickAddFriendToSlip,
      getPayerName,
      getBillTotal,
      validConsumers,
      getConsumerNames,
      isConsumedByMe,
      isSlipConsumedByMe,
      getMemberBillShare,
      formatMoney
    };
  }
}).mount('#app');
