// ============================================
// orders.js — Orders Module
// ============================================
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, doc, updateDoc, getDoc,
  query, orderBy, where, onSnapshot, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// الحالات التي يُسمح فيها للزبون بالإلغاء (قبل خروج السائق)
export const CUSTOMER_CANCELLABLE_STATUSES = ['جديد', 'قيد التجهيز'];

// رابط قاعدة التطبيق (يُستخدم في روابط التليجرام)
// نقرأه من Firestore أولاً (settings/general.appUrl)، وهذا هو الافتراضي
let APP_BASE_URL = 'https://irish-a68ec.web.app';
(async () => {
  try {
    const snap = await getDoc(doc(db, 'settings', 'general'));
    if (snap.exists() && snap.data().appUrl) APP_BASE_URL = snap.data().appUrl.replace(/\/$/, '');
  } catch {}
})();

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

  const productsTotal = (order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0);
  const grandTotal    = productsTotal + (order.deliveryFee || 0);

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
🚚 أجرة التوصيل: ${deliveryFeeStr}
💰 *الإجمالي: ${fmt(grandTotal)}*
━━━━━━━━━━━━━━━━━━${mapLine}`
  );
}

// ── Send notification to agent's personal Telegram ──
async function sendAgentTelegramNotification(order, agent) {
  try {
    const tg = await getTelegramSettings();
    if (!tg || !tg.botToken || !agent.telegramId) return;
    const fmt = (n) => new Intl.NumberFormat('en-US').format(n) + ' د.ع';
    const shortId = order.id.slice(-6).toUpperCase();
    const itemLines = (order.items || [])
      .map(i => `  • ${i.name} × ${i.quantity}  ←  ${fmt(i.price * i.quantity)}`)
      .join('\n');
    const mapLine = order.location
      ? `\n📌 [موقع الزبون](https://www.google.com/maps?q=${order.location.lat},${order.location.lng})`
      : order.address ? `\n📝 العنوان: ${order.address}` : '';
    const productsTotal = (order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0);
    const grandTotal = productsTotal + (order.deliveryFee || 0);
    const orderLink = `${APP_BASE_URL}/pages/agent-dashboard.html`;

    const message =
`📦 *طلب جديد بانتظارك — Irish Bar*
━━━━━━━━━━━━━━━━━━
🆔 رقم الطلب: \`#${shortId}\`
👤 الزبون: ${order.customerName}
📞 الهاتف: ${order.phone}
🕐 وقت التوصيل: ${order.deliveryTime || '—'}
━━━━━━━━━━━━━━━━━━
🛒 *المنتجات:*
${itemLines}
━━━━━━━━━━━━━━━━━━
🚚 أجرة التوصيل: ${fmt(order.deliveryFee || 0)}
💰 *الإجمالي: ${fmt(grandTotal)}*
━━━━━━━━━━━━━━━━━━${mapLine}
🔗 [افتح لوحة الوكيل لتعيين السائق](${orderLink})`;

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
      const productsTotal = (order.items||[]).reduce((s,i)=>s+(i.price*i.quantity),0);
      const grandTotal = productsTotal + (order.deliveryFee||0);

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
💰 *الإجمالي: ${fmt(grandTotal)}*${mapLine}`;
    } else {
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
    needsRating: false,
    createdAt: new Date().toISOString()
  };
  const ref = await addDoc(collection(db, 'orders'), order);
  const fullOrder = { id: ref.id, ...order };

  // 🔔 إشعار الأدمن بالطلب الجديد — القرار بتعيين الوكيل للأدمن يدوياً
  sendTelegramNotification(fullOrder);

  return fullOrder;
}

// ── Assign Agent to Order (called by admin) ───────────────────────────────────
export async function assignAgentToOrder(orderId, agent) {
  const orderSnap = await getDoc(doc(db, 'orders', orderId));
  if (!orderSnap.exists()) throw new Error('الطلب غير موجود');
  const order = { id: orderId, ...orderSnap.data() };

  // قيمة الطلب الكاملة = المنتجات + التوصيل
  const orderBase = (order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0) + (order.deliveryFee || 0);

  await updateDoc(doc(db, 'orders', orderId), {
    agentId:    agent.id,
    agentName:  agent.name,
    orderBase,  // نحفظها لاسترجاعها عند الإلغاء
    status:     'قيد التجهيز',
    assignedAgentAt: new Date().toISOString()
  });

  const fullOrder = { ...order, agentId: agent.id, agentName: agent.name, orderBase };
  // 🔔 إشعار الوكيل على تلجرام مع رابط لوحة التحكم
  if (agent.telegramId) sendAgentTelegramNotification(fullOrder, agent);
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
  const updates = { status };

  // عند اكتمال الطلب: طلب التقييم من الزبون
  if (status === 'مكتمل') {
    updates.needsRating  = true;
    updates.completedAt  = new Date().toISOString();
  }

  await updateDoc(doc(db, 'orders', orderId), updates);

  // 🔔 إشعار Telegram على التحديثات
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
      ? `\n📌 [موقع الزبون](https://www.google.com/maps?q=${order.location.lat},${order.location.lng})`
      : order.address ? `\n📝 العنوان: ${order.address}` : '';
    const orderLink = `${APP_BASE_URL}/pages/driver-dashboard.html`;

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
🚚 أجرة التوصيل: ${fmt(order.deliveryFee || 0)}
💰 *قيمة الطلب: ${fmt(order.orderBase || 0)}*${mapLine}
━━━━━━━━━━━━━━━━━━
🔗 [افتح لوحة السائق لتأكيد الاستلام](${orderLink})`;

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
// يستقطع قيمة الطلب الكاملة من رصيد الوكيل ومن رصيد السائق
export async function assignDriverToOrder(orderId, driver) {
  const orderSnap = await getDoc(doc(db, 'orders', orderId));
  if (!orderSnap.exists()) throw new Error('الطلب غير موجود');
  const order = { id: orderId, ...orderSnap.data() };

  // قيمة الطلب الكاملة = المنتجات + التوصيل
  const orderBase = order.orderBase ||
    ((order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0) + (order.deliveryFee || 0));

  // ── التحقق من رصيد السائق ─────────────────────────────────────────────────
  const driverSnap = await getDoc(doc(db, 'drivers', driver.id));
  const driverBalance = (driverSnap.exists() ? driverSnap.data().balance : 0) || 0;
  if (driverBalance < orderBase) {
    const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
    throw new Error(
      `رصيد السائق ${driver.name} غير كافٍ — الرصيد الحالي: ${fmt(driverBalance)} د.ع، قيمة الطلب: ${fmt(orderBase)} د.ع`
    );
  }

  // ── التحقق من رصيد الوكيل ────────────────────────────────────────────────
  if (order.agentId) {
    const agentSnap = await getDoc(doc(db, 'agents', order.agentId));
    const agentBalance = (agentSnap.exists() ? agentSnap.data().balance : 0) || 0;
    if (agentBalance < orderBase) {
      const fmt = (n) => new Intl.NumberFormat('en-US').format(n);
      throw new Error(
        `رصيد الوكيل غير كافٍ — الرصيد الحالي: ${fmt(agentBalance)} د.ع، قيمة الطلب: ${fmt(orderBase)} د.ع`
      );
    }
  }

  // ── تحديث الطلب ───────────────────────────────────────────────────────────
  await updateDoc(doc(db, 'orders', orderId), {
    driverId:        driver.id,
    driverName:      driver.name,
    driverDeduction: orderBase,
    agentDeduction:  orderBase,
    status:          'في التوصيل',
    assignedAt:      new Date().toISOString()
  });

  // ── استقطاع رصيد السائق (القيمة الكاملة) ─────────────────────────────────
  await updateDoc(doc(db, 'drivers', driver.id), {
    balance:   increment(-orderBase),
    updatedAt: new Date().toISOString()
  });
  await addDoc(collection(db, 'balance_deductions'), {
    driverId:  driver.id,
    amount:    orderBase,
    orderId,
    note: `طلب #${orderId.slice(-6).toUpperCase()} — قيمة كاملة`,
    createdAt: new Date().toISOString()
  });

  // ── استقطاع رصيد الوكيل (القيمة الكاملة) ─────────────────────────────────
  if (order.agentId) {
    await updateDoc(doc(db, 'agents', order.agentId), {
      balance:   increment(-orderBase),
      updatedAt: new Date().toISOString()
    });
    await addDoc(collection(db, 'balance_deductions'), {
      agentId:  order.agentId,
      amount:   orderBase,
      orderId,
      note: `طلب #${orderId.slice(-6).toUpperCase()} — قيمة كاملة`,
      createdAt: new Date().toISOString()
    });
  }

  // 🔔 إشعار تلجرام للسائق مع رابط لوحة التحكم
  const fullOrder = { ...order, driverId: driver.id, driverName: driver.name, orderBase };
  sendDriverTelegramNotification(fullOrder, driver);
}

// ── Cancel Order ──────────────────────────────────────────────────────────────
// cancelledBy: 'customer' | 'admin'
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

  // ── استرجاع رصيد الوكيل إن كان قد خُصم ───────────────────────────────────
  if (order.agentId && order.agentDeduction > 0) {
    try {
      await updateDoc(doc(db, 'agents', order.agentId), {
        balance:   increment(order.agentDeduction),
        updatedAt: new Date().toISOString()
      });
      await addDoc(collection(db, 'balance_topups'), {
        targetId:     order.agentId,
        targetType:   'agent_refund',
        orderId,
        creditAmount: order.agentDeduction,
        paidAmount:   0,
        note: `استرجاع — طلب ملغي #${orderId.slice(-6).toUpperCase()}`,
        createdAt:    new Date().toISOString()
      });
    } catch (e) {
      console.warn('Agent refund failed:', e);
    }
  }

  // 🔔 إشعار Telegram
  sendStatusNotification(orderId, 'ملغي');

  return order;
}

// ── Submit Customer Rating ────────────────────────────────────────────────────
export async function submitOrderRating(orderId, { driverRating, orderRating, comment = '' }) {
  await updateDoc(doc(db, 'orders', orderId), {
    needsRating:   false,
    driverRating:  driverRating,
    orderRating:   orderRating,
    ratingComment: comment,
    ratedAt:       new Date().toISOString()
  });
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
