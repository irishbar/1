// ============================================
// orders.js — Orders Module
// ============================================
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, doc, updateDoc, getDoc,
  query, orderBy, where, onSnapshot, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { fetchAgents, getCoverageStatus, AGENT_COMMISSION_RATE } from './agents.js';
import { deductDriverBalance } from './drivers.js';

// الحالات التي يُسمح فيها للزبون بالإلغاء (قبل خروج السائق)
export const CUSTOMER_CANCELLABLE_STATUSES = ['جديد', 'قيد التجهيز'];

// ──────────────────────────────────────────
// TELEGRAM NOTIFICATION
// ──────────────────────────────────────────
async function getTelegramSettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'telegram'));
    if (snap.exists()) return snap.data();
  } catch {}
  return null;
}

function buildTelegramMessage(order) {
  const fmt = (n) => new Intl.NumberFormat('en-US').format(n) + ' د.ع';
  const shortId = order.id.slice(-6).toUpperCase();

  // Build items list
  const itemLines = (order.items || [])
    .map(i => `  • ${i.name} × ${i.quantity}  ←  ${fmt(i.price * i.quantity)}`)
    .join('\n');

  // Map link if location exists
  const mapLine = order.location
    ? `\n📌 [عرض الموقع على الخارطة](https://www.google.com/maps?q=${order.location.lat},${order.location.lng})`
    : order.address ? `\n📝 ملاحظات: ${order.address}` : '';

  const deliveryFeeStr = order.deliveryFee ? fmt(order.deliveryFee) : '—';

  // المجموع الكلي = منتجات + توصيل + عمولة وكيل + عمولة منصة
  const productsTotal = (order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0);
  const grandTotal    = productsTotal + (order.deliveryFee || 0) + (order.agentShare || 0) + (order.platformShare || 0);

  // تفاصيل توزيع العمولة (للإدارة فقط - لا تؤثر على مبلغ العميل)
  let commissionLine = '';
  if (order.agentShare || order.platformShare) {
    commissionLine = `\n   ├ وكيل: ${order.agentShare ? fmt(order.agentShare) : '—'}  |  منصة: ${order.platformShare ? fmt(order.platformShare) : '—'}`;
  }

  return (
`🥃 *طلب جديد — Irish Bar*
━━━━━━━━━━━━━━━━━━
🆔 رقم الطلب: \`#${shortId}\`
👤 العميل: ${order.customerName}
📞 الهاتف: ${order.phone}
🕐 وقت التوصيل: ${order.deliveryTime}
━━━━━━━━━━━━━━━━━━
🛒 *المنتجات:*
${itemLines}
━━━━━━━━━━━━━━━━━━
🚚 أجرة التوصيل: ${deliveryFeeStr}${commissionLine}
💰 *الإجمالي: ${fmt(grandTotal)}*
━━━━━━━━━━━━━━━━━━${mapLine}`
  );
}

// ── Send notification to agent's personal Telegram ──
async function sendAgentTelegramNotification(order, agent) {
  try {
    const tg = await getTelegramSettings();
    if (!tg || !tg.botToken || !agent.telegramId) return;
    const message = buildTelegramMessage(order);
    await fetch(
      `https://api.telegram.org/bot${tg.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    agent.telegramId,
          text:       message,
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        })
      }
    );
  } catch (e) {
    console.warn('Agent Telegram notification failed:', e);
  }
}

async function sendTelegramNotification(order) {
  try {
    const tg = await getTelegramSettings();
    if (!tg || !tg.enabled || !tg.botToken || !tg.chatId) return;
    // Check trigger setting (default true for new orders)
    if (tg.notif_new_order === false) return;

    const message = buildTelegramMessage(order);
    await fetch(
      `https://api.telegram.org/bot${tg.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id:    tg.chatId,
          text:       message,
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        })
      }
    );
  } catch (e) {
    console.warn('Telegram notification failed:', e);
    // Fail silently — don't break order flow
  }
}

// ── Send notification on status change ──
async function sendStatusNotification(orderId, status) {
  try {
    const tg = await getTelegramSettings();
    if (!tg || !tg.enabled || !tg.botToken || !tg.chatId) return;

    const shouldNotify =
      (status === 'قيد التجهيز' && tg.notif_preparing)  ||
      (status === 'مكتمل'       && tg.notif_completed)   ||
      (status === 'ملغي'        && tg.notif_cancelled);
    if (!shouldNotify) return;

    // Fetch full order details for a rich message
    const orderSnap = await getDoc(doc(db, 'orders', orderId));
    const order = orderSnap.exists() ? { id: orderId, ...orderSnap.data() } : null;

    const fmt = (n) => new Intl.NumberFormat('en-US').format(n) + ' د.ع';
    const shortId = orderId.slice(-6).toUpperCase();

    const statusIcons = {
      'قيد التجهيز': '🟡',
      'مكتمل':       '✅',
      'ملغي':        '❌'
    };
    const icon = statusIcons[status] || '🔔';

    let msg;
    if (order) {
      const itemLines = (order.items || [])
        .map(i => `  • ${i.name} × ${i.quantity}  ←  ${fmt((i.price||0) * (i.quantity||1))}`)
        .join('\n');
      const mapLine = order.location
        ? `\n📌 [موقع العميل](https://www.google.com/maps?q=${order.location.lat},${order.location.lng})`
        : order.address ? `\n📝 العنوان: ${order.address}` : '';

      msg =
`${icon} *تحديث طلب — Irish Bar*
━━━━━━━━━━━━━━━━━━
🆔 رقم الطلب: \`#${shortId}\`
📋 الحالة الجديدة: *${status}*
👤 العميل: ${order.customerName || '—'}
📞 الهاتف: ${order.phone || '—'}
━━━━━━━━━━━━━━━━━━
🛒 *المنتجات:*
${itemLines || '—'}
━━━━━━━━━━━━━━━━━━
🚚 أجرة التوصيل: ${order.deliveryFee ? fmt(order.deliveryFee) : '—'}
💰 *الإجمالي: ${fmt(((order.items||[]).reduce((s,i)=>s+(i.price*i.quantity),0)) + (order.deliveryFee||0) + (order.agentShare||0) + (order.platformShare||0))}*${mapLine}`;
    } else {
      // Fallback if order fetch fails
      msg = `${icon} *تحديث طلب — Irish Bar*\n\`#${shortId}\`\nالحالة: *${status}*`;
    }

    await fetch(
      `https://api.telegram.org/bot${tg.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tg.chatId,
          text: msg,
          parse_mode: 'Markdown',
          disable_web_page_preview: true
        })
      }
    );
  } catch (e) {
    console.warn('Telegram status notification failed:', e);
  }
}

// ──────────────────────────────────────────
// CREATE ORDER
// ──────────────────────────────────────────
export async function createOrder({ customerId, customerName, phone, address, deliveryTime, items, total, deliveryFee = 0, location = null }) {
  const order = {
    customerId,
    customerName,
    phone,
    address,
    deliveryTime,
    items,
    total,
    deliveryFee,
    location,
    status: 'جديد',
    createdAt: new Date().toISOString()
  };
  const ref = await addDoc(collection(db, 'orders'), order);
  const fullOrder = { id: ref.id, ...order };

  // 🤝 Auto-assign nearest agent if location provided
  if (location?.lat && location?.lng) {
    try {
      const agents = await fetchAgents();
      const coverage = getCoverageStatus(location.lat, location.lng, agents);
      if (coverage.covered && coverage.nearest) {
        const agent    = coverage.nearest;
        const commType = agent.commissionType ?? 'percent';
        const commVal  = agent.commissionRate ?? (AGENT_COMMISSION_RATE * 100);
        // عمولة الوكيل مستقلة — على إجمالي الطلب
        const orderBase = (order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0) + deliveryFee;
        const agentShare = commType === 'fixed'
          ? Number(commVal)
          : Math.round(orderBase * commVal / 100);
        await updateDoc(doc(db, 'orders', ref.id), { agentId: agent.id, agentShare });
        fullOrder.agentId = agent.id;
        fullOrder.agentShare = agentShare;
        // 🔔 Notify agent on their personal Telegram
        if (agent.telegramId) sendAgentTelegramNotification(fullOrder, agent);
      }
    } catch (e) { console.warn('Agent assignment failed:', e); }
  }

  // 🔔 Send Telegram notification to admin (non-blocking)
  sendTelegramNotification(fullOrder);

  return fullOrder;
}

// ── Fetch All Orders (admin/manager) ──
export async function fetchAllOrders() {
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Fetch Customer Orders ──
export async function fetchMyOrders(customerId) {
  const q = query(
    collection(db, 'orders'),
    where('customerId', '==', customerId),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Update Order Status ──
export async function updateOrderStatus(orderId, status) {
  await updateDoc(doc(db, 'orders', orderId), { status });
  // 🔔 Send Telegram notification for completed/cancelled
  sendStatusNotification(orderId, status);
}

// ── Send notification to driver's personal Telegram ──
async function sendDriverTelegramNotification(order, driver) {
  try {
    const tg = await getTelegramSettings();
    if (!tg || !tg.botToken || !driver.telegramId) return;
    const fmt = (n) => new Intl.NumberFormat('en-US').format(n) + ' د.ع';
    const shortId = order.id.slice(-6).toUpperCase();
    const itemLines = (order.items || [])
      .map(i => `  • ${i.name} × ${i.quantity}`)
      .join('\n');
    const mapLine = order.location
      ? `\n📌 [موقع العميل](https://www.google.com/maps?q=${order.location.lat},${order.location.lng})`
      : order.address ? `\n📝 العنوان: ${order.address}` : '';
    const msg =
`🏍️ *طلب توصيل جديد لك*
━━━━━━━━━━━━━━━━━━
🆔 رقم الطلب: \`#${shortId}\`
👤 الزبون: ${order.customerName}
📞 الهاتف: ${order.phone}
🕐 وقت التوصيل: ${order.deliveryTime || '—'}
━━━━━━━━━━━━━━━━━━
🛒 *المنتجات:*
${itemLines}
━━━━━━━━━━━━━━━━━━
🚚 أجرة التوصيل: ${fmt(order.deliveryFee || 0)}${mapLine}`;
    await fetch(
      `https://api.telegram.org/bot${tg.botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: driver.telegramId,
          text: msg,
          parse_mode: 'Markdown',
          disable_web_page_preview: false
        })
      }
    );
  } catch (e) {
    console.warn('Driver Telegram notification failed:', e);
  }
}

// ── Assign Driver to Order (called by agent) ──────────────────────────────────
export async function assignDriverToOrder(orderId, driver) {
  const orderSnap = await getDoc(doc(db, 'orders', orderId));
  if (!orderSnap.exists()) throw new Error('الطلب غير موجود');
  const order = { id: orderId, ...orderSnap.data() };

  // احسب الخصم من رصيد السائق (نسبة عمولة السائق × قيمة الطلب)
  const orderBase = (order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0) + (order.deliveryFee || 0);
  const rate = driver.commissionRate ?? 15;
  const driverDeduction = Math.round(orderBase * rate / 100);

  // حدّث الطلب
  await updateDoc(doc(db, 'orders', orderId), {
    driverId:        driver.id,
    driverName:      driver.name,
    driverDeduction,
    status:          'في التوصيل',
    assignedAt:      new Date().toISOString()
  });

  // اخصم من رصيد السائق
  await deductDriverBalance(driver.id, driverDeduction, orderId);

  // أرسل إشعار تلجرام للسائق
  const fullOrder = { ...order, driverId: driver.id, driverName: driver.name };
  sendDriverTelegramNotification(fullOrder, driver);
}

// ── Cancel Order ──────────────────────────────────────────────────────────────
// cancelledBy: 'customer' | 'admin'
// الزبون: يُسمح له فقط قبل خروج السائق (جديد / قيد التجهيز)
// الأدمن:  يستطيع الإلغاء في أي وقت
export async function cancelOrder(orderId, cancelledBy = 'admin') {
  const orderSnap = await getDoc(doc(db, 'orders', orderId));
  if (!orderSnap.exists()) throw new Error('الطلب غير موجود');
  const order = { id: orderId, ...orderSnap.data() };

  // التحقق من صلاحية الزبون
  if (cancelledBy === 'customer') {
    if (!CUSTOMER_CANCELLABLE_STATUSES.includes(order.status)) {
      throw new Error('لا يمكن إلغاء الطلب بعد خروج السائق — تواصل مع الإدارة');
    }
  }

  // تحديث حالة الطلب
  await updateDoc(doc(db, 'orders', orderId), {
    status:      'ملغي',
    cancelledBy,
    cancelledAt: new Date().toISOString()
  });

  // ── استرجاع رصيد السائق إن كان قد خُصم ──────────────────────────────────
  if (order.driverId && order.driverDeduction > 0) {
    try {
      await updateDoc(doc(db, 'drivers', order.driverId), {
        balance:   increment(order.driverDeduction),
        updatedAt: new Date().toISOString()
      });
      // تسجيل الاسترجاع في سجل التعزيزات
      await addDoc(collection(db, 'balance_topups'), {
        targetId:     order.driverId,
        targetType:   'driver_refund',
        orderId,
        creditAmount: order.driverDeduction,
        paidAmount:   0,
        note: `استرجاع — طلب ملغي #${orderId.slice(-6).toUpperCase()}`,
        createdAt:    new Date().toISOString()
      });
    } catch (e) {
      console.warn('Driver refund failed:', e);
    }
  }

  // 🔔 إشعار Telegram
  sendStatusNotification(orderId, 'ملغي');

  return order;
}

// ── Real-time Orders Listener (for admin) ──
export function listenToOrders(callback) {
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  return onSnapshot(q, (snap) => {
    const orders = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    callback(orders);
  });
}

// ── Order Status Config ──
export const ORDER_STATUSES = [
  { value: 'جديد',       label: 'جديد',        color: 'blue' },
  { value: 'قيد التجهيز', label: 'قيد التجهيز', color: 'gold' },
  { value: 'في التوصيل', label: 'في التوصيل',   color: 'green' },
  { value: 'مكتمل',      label: 'مكتمل',        color: 'green' },
  { value: 'ملغي',       label: 'ملغي',         color: 'red' }
];

export function getStatusBadgeClass(status) {
  const map = {
    'جديد': 'badge-blue',
    'قيد التجهيز': 'badge-gold',
    'في التوصيل': 'badge-green',
    'مكتمل': 'badge-green',
    'ملغي': 'badge-red'
  };
  return map[status] || 'badge-gray';
}

// ── Format price ──
export function formatPrice(n) {
  return new Intl.NumberFormat('en-US').format(n) + ' د.ع';
}
