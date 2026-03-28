// ============================================
// orders.js — Orders Module
// ============================================
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, doc, updateDoc, getDoc,
  query, orderBy, where, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

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
💰 *الإجمالي: ${fmt(order.total)}*
━━━━━━━━━━━━━━━━━━${mapLine}`
  );
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
💰 *الإجمالي: ${fmt(order.total || 0)}*${mapLine}`;
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

  // 🔔 Send Telegram notification (non-blocking)
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
