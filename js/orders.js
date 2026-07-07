// ============================================
// orders.js — Orders Module
// ============================================
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, doc, updateDoc, getDoc,
  query, orderBy, where, onSnapshot, increment, runTransaction
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

  const itemLines = (order.items || [])
    .map(i => `  • ${i.name}${i.selectedSize ? ' ('+i.selectedSize.name+')' : ''} × ${i.quantity}  ←  ${fmt(i.price * i.quantity)}`)
    .join('\n');

  const mapLine = order.location
    ? `\n📌 [عرض الموقع على الخارطة](https://www.google.com/maps?q=${order.location.lat},${order.location.lng})`
    : order.address ? `\n📝 ملاحظات: ${order.address}` : '';

  const productsTotal = (order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0);
  const agentShare    = order.agentShare    || 0;
  const platformShare = order.platformShare || 0;
  const grandTotal    = productsTotal + (order.deliveryFee || 0) + agentShare + platformShare;

  const commissionLines = (agentShare > 0 || platformShare > 0)
    ? `\n💸 عمولة الوكيل: ${fmt(agentShare)}\n🏢 عمولة المنصة: ${fmt(platformShare)}`
    : '';

  const agentLine = order.suggestedAgentName
    ? `\n👥 الوكيل المعتمد: *${order.suggestedAgentName}*`
    : '\n⚠️ لم يُكتشف وكيل قريب — يرجى التعيين يدوياً';

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
🚚 أجرة التوصيل: ${order.deliveryFee ? fmt(order.deliveryFee) : '—'}${commissionLines}
💰 *المجموع الكلي: ${fmt(grandTotal)}*
━━━━━━━━━━━━━━━━━━${agentLine}${mapLine}`
  );
}

// ── Send "new order assigned" notification to agent ──
async function sendAgentTelegramNotification(order, agent) {
  try {
    const tg = await getTelegramSettings();
    if (!tg || !tg.botToken || !agent.telegramId) return;
    const fmt = (n) => new Intl.NumberFormat('en-US').format(n) + ' د.ع';
    const shortId = order.id.slice(-6).toUpperCase();
    const itemLines = (order.items || [])
      .map(i => `  • ${i.name}${i.selectedSize ? ' ('+i.selectedSize.name+')' : ''} × ${i.quantity}  ←  ${fmt(i.price * i.quantity)}`)
      .join('\n');
    const mapLine = order.location
      ? `\n📌 [موقع الزبون](https://www.google.com/maps?q=${order.location.lat},${order.location.lng})`
      : order.address ? `\n📝 العنوان: ${order.address}` : '';
    const productsTotal = (order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0);
    const agentShare2    = order.agentShare    || 0;
    const platformShare2 = order.platformShare || 0;
    const grandTotal = productsTotal + (order.deliveryFee || 0) + agentShare2 + platformShare2;
    const orderLink = `${APP_BASE_URL}/pages/agent-dashboard.html`;

    const commissionLines2 = (agentShare2 > 0 || platformShare2 > 0)
      ? `\n💸 عمولتك: ${fmt(agentShare2)}\n🏢 عمولة المنصة: ${fmt(platformShare2)}`
      : '';

    const message =
`✅ *تم تأكيد طلب جديد لك — Irish Bar*
━━━━━━━━━━━━━━━━━━
🆔 رقم الطلب: \`#${shortId}\`
👤 الزبون: ${order.customerName}
📞 الهاتف: ${order.phone}
🕐 وقت التوصيل: ${order.deliveryTime || '—'}
━━━━━━━━━━━━━━━━━━
🛒 *المنتجات:*
${itemLines}
━━━━━━━━━━━━━━━━━━
🚚 أجرة التوصيل: ${fmt(order.deliveryFee || 0)}${commissionLines2}
💰 *المجموع الكلي: ${fmt(grandTotal)}*
━━━━━━━━━━━━━━━━━━${mapLine}
🔗 [افتح لوحة الوكيل لتعيين السائق](${orderLink})`;

    const res  = await fetch(
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
    const json = await res.json();
    if (!json.ok) console.warn('Agent Telegram failed:', json.description, '| chatId:', agent.telegramId);
  } catch (e) {
    console.warn('Agent Telegram notification failed:', e);
  }
}

async function sendAgentEmailNotification(order, agent) {
  if (!agent.email) return;
  try {
    const fmt = n => new Intl.NumberFormat('en-US').format(n) + ' د.ع';
    const shortId = order.id.slice(-6).toUpperCase();
    const itemsRows = (order.items || [])
      .map(i => `<tr><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;">${i.name}${i.selectedSize ? ' <span style="color:#b8922a;">('+i.selectedSize.name+')</span>' : ''}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;text-align:center;">${i.quantity}</td><td style="padding:6px 10px;border-bottom:1px solid #f0f0f0;" dir="ltr">${fmt((i.price||0) * (i.quantity||1))}</td></tr>`)
      .join('');
    const html = `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:600px;margin:0 auto;background:#fff;border-radius:12px;border:1px solid #e8e0d0;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#1a3a2a,#2d6a4f);padding:24px;text-align:center;">
    <h1 style="color:#d4aa45;margin:0;font-size:1.4rem;">🥃 Irish Bar</h1>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:0.9rem;">طلب جديد مُعيَّن إليك</p>
  </div>
  <div style="padding:24px;">
    <p style="font-size:1rem;color:#1a3a2a;font-weight:700;margin-bottom:4px;">مرحباً ${agent.name || 'الوكيل'}،</p>
    <p style="color:#555;margin-bottom:20px;">لديك طلب جديد بانتظارك <strong style="color:#b8922a;">#${shortId}</strong></p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:20px;border:1px solid #e8e0d0;">
      <thead><tr style="background:#f5f0e8;"><th style="padding:8px 10px;text-align:right;">المنتج</th><th style="padding:8px 10px;text-align:center;">الكمية</th><th style="padding:8px 10px;text-align:right;">المبلغ</th></tr></thead>
      <tbody>${itemsRows}</tbody>
    </table>
    <div style="background:#f8f5ee;border-radius:8px;padding:16px;margin-bottom:16px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#666;">الزبون:</span><strong>${order.customerName}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#666;">الهاتف:</span><strong dir="ltr">${order.phone}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#666;">وقت التوصيل:</span><strong>${order.deliveryTime || 'اسرع وقت'}</strong></div>
      <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><span style="color:#666;">أجرة التوصيل:</span><strong>${fmt(order.deliveryFee || 0)}</strong></div>
      <div style="display:flex;justify-content:space-between;border-top:1px solid #e0d8c8;padding-top:8px;margin-top:4px;"><span style="color:#666;font-weight:700;">عمولتك:</span><strong style="color:#2d6a4f;font-size:1.1rem;">${fmt(order.agentShare || 0)}</strong></div>
    </div>
    <a href="${APP_BASE_URL}/pages/agent-dashboard.html" style="display:block;text-align:center;background:linear-gradient(135deg,#1a3a2a,#2d6a4f);color:#fff;padding:14px;border-radius:8px;text-decoration:none;font-weight:700;">افتح لوحة الوكيل</a>
  </div>
  <div style="background:#f8f5ee;padding:14px;text-align:center;font-size:0.78rem;color:#888;">تم الإرسال تلقائياً من منصة Irish Bar</div>
</div>`;
    await addDoc(collection(db, 'mail'), {
      to: agent.email,
      message: { subject: `🥃 طلب جديد #${shortId} — Irish Bar`, html }
    });
  } catch (e) {
    console.warn('Email notification failed:', e);
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
export async function createOrder({
  customerId, customerName, phone, address, deliveryTime, items, total,
  deliveryFee = 0, location = null,
  suggestedAgentId = null, suggestedAgentName = null,
  agentShare = 0, platformShare = 0,
  paymentMethod = 'cash', paymentStatus = 'pending'
}) {
  const order = {
    customerId:         customerId        || 'guest',
    customerName:       customerName      || '',
    phone:              phone             || '',
    address:            address           || '',
    deliveryTime:       deliveryTime      || 'اسرع وقت',
    items:              items             || [],
    total:              isNaN(total)      ? 0 : (total || 0),
    deliveryFee:        isNaN(deliveryFee)? 0 : (deliveryFee || 0),
    location:           location          || null,
    agentId:            suggestedAgentId  || null,
    agentName:          suggestedAgentName|| null,
    suggestedAgentId:   suggestedAgentId  || null,
    suggestedAgentName: suggestedAgentName|| null,
    agentShare:         isNaN(agentShare)    ? 0 : (agentShare    || 0),
    platformShare:      isNaN(platformShare) ? 0 : (platformShare  || 0),
    paymentMethod:      paymentMethod     || 'cash',
    paymentStatus:      paymentStatus     || 'pending',
    status:             'جديد',
    needsRating:        false,
    createdAt:          new Date().toISOString()
  };
  const ref = await addDoc(collection(db, 'orders'), order);
  const fullOrder = { id: ref.id, ...order };

  // 🔔 إشعار الأدمن مع اسم الوكيل المقترح
  sendTelegramNotification(fullOrder);

  // 🔔 إشعار فوري للوكيل المُعيَّن تلقائياً
  if (suggestedAgentId) {
    (async () => {
      try {
        const agentSnap = await getDoc(doc(db, 'agents', suggestedAgentId));
        if (agentSnap.exists()) {
          const agent = { id: agentSnap.id, ...agentSnap.data() };
          if (agent.telegramId) sendAgentTelegramNotification(fullOrder, agent);
          if (agent.email)      sendAgentEmailNotification(fullOrder, agent);
        }
      } catch {}
    })();
  }

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
  // 🔔 إشعار الوكيل بتأكيد الطلب
  if (agent.telegramId) sendAgentTelegramNotification(fullOrder, agent);
}

// ── Auto-assign nearest active agent to an order (called after 3-minute timeout) ──
export async function autoAssignNearestAgent(orderId, agents) {
  const orderSnap = await getDoc(doc(db, 'orders', orderId));
  if (!orderSnap.exists()) return null;
  const order = { id: orderId, ...orderSnap.data() };

  // Skip if already assigned or no longer in new status
  if (order.agentId || order.status !== 'جديد') return null;

  const activeAgents = agents.filter(a => a.active !== false);
  if (!activeAgents.length) return null;

  let agentToAssign = null;

  // Prefer the pre-detected suggested agent
  if (order.suggestedAgentId) {
    agentToAssign = activeAgents.find(a => a.id === order.suggestedAgentId) || null;
  }

  // Fall back to nearest by Haversine distance
  if (!agentToAssign && order.location) {
    const { lat, lng } = order.location;
    function hav(la1,lo1,la2,lo2){
      const R=6371,dLat=(la1-la2)*Math.PI/180,dLng=(lo1-lo2)*Math.PI/180;
      const a=Math.sin(dLat/2)**2+Math.cos(la2*Math.PI/180)*Math.cos(la1*Math.PI/180)*Math.sin(dLng/2)**2;
      return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
    }
    let minDist = Infinity;
    for (const a of activeAgents) {
      if (!a.lat || !a.lng) continue;
      const d = hav(lat, lng, a.lat, a.lng);
      if (d < minDist) { minDist = d; agentToAssign = a; }
    }
  }

  if (!agentToAssign) return null;
  await assignAgentToOrder(orderId, agentToAssign);
  return agentToAssign;
}

// ── Fetch All Orders (admin/manager) ──
export async function fetchAllOrders() {
  const q = query(collection(db, 'orders'), orderBy('createdAt', 'desc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Fetch Agent Orders (filtered query — fast) ──
export async function fetchAgentOrders(agentId) {
  const q = query(
    collection(db, 'orders'),
    where('agentId', '==', agentId),
    orderBy('createdAt', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ── Real-time listener for agent orders ──
export function listenAgentOrders(agentId, callback) {
  const q = query(
    collection(db, 'orders'),
    where('agentId', '==', agentId),
    orderBy('createdAt', 'desc')
  );
  return onSnapshot(q,
    snap => callback(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    err  => console.warn('listenAgentOrders:', err)
  );
}

// ── Update order status by agent (with optional extra fields like driverName) ──
export async function updateAgentOrderStatus(orderId, status, extra = {}) {
  const updates = { status, updatedAt: new Date().toISOString(), ...extra };
  if (status === 'مكتمل') {
    updates.needsRating = true;
    updates.completedAt = new Date().toISOString();
  }
  await updateDoc(doc(db, 'orders', orderId), updates);
  sendStatusNotification(orderId, status);
}

// ── Fetch Driver Active Orders ──
export async function fetchDriverOrders(driverId) {
  const q = query(
    collection(db, 'orders'),
    where('driverId', '==', driverId),
    orderBy('createdAt', 'desc')
  );
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

    const res  = await fetch(
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
    const json = await res.json();
    if (!json.ok) console.warn('Driver Telegram failed:', json.description, '| chatId:', driver.telegramId);
  } catch (e) {
    console.warn('Driver Telegram notification failed:', e);
  }
}

// ── Assign Driver to Order (called by agent) ──────────────────────────────────
// يستخدم Firestore Transaction لمنع Race Condition عند تزامن التعيين
export async function assignDriverToOrder(orderId, driver) {
  const fmt = (n) => new Intl.NumberFormat('en-US').format(n);

  const orderRef  = doc(db, 'orders',  orderId);
  const driverRef = doc(db, 'drivers', driver.id);

  // نُنشئ مراجع السجلات الجديدة مسبقاً (لا يمكن استخدام addDoc داخل transaction)
  const driverDeductRef = doc(collection(db, 'balance_deductions'));
  const agentDeductRef  = doc(collection(db, 'balance_deductions'));

  let capturedOrder = null;

  await runTransaction(db, async (transaction) => {
    const orderSnap  = await transaction.get(orderRef);
    const driverSnap = await transaction.get(driverRef);

    if (!orderSnap.exists()) throw new Error('الطلب غير موجود');
    const order = { id: orderId, ...orderSnap.data() };

    // التحقق من حالة الطلب
    if (!['جديد', 'قيد التجهيز'].includes(order.status)) {
      throw new Error('لا يمكن تعيين سائق لهذا الطلب — الحالة: ' + order.status);
    }

    const orderBase = order.orderBase ||
      ((order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0) + (order.deliveryFee || 0));

    // التحقق من رصيد السائق
    const driverBalance = driverSnap.exists() ? (driverSnap.data().balance || 0) : 0;
    if (driverBalance < orderBase) {
      throw new Error(
        `رصيد السائق ${driver.name} غير كافٍ — الرصيد: ${fmt(driverBalance)} د.ع، الطلب: ${fmt(orderBase)} د.ع`
      );
    }

    // التحقق من رصيد الوكيل
    let agentRef = null;
    if (order.agentId) {
      agentRef = doc(db, 'agents', order.agentId);
      const agentSnap = await transaction.get(agentRef);
      const agentBalance = agentSnap.exists() ? (agentSnap.data().balance || 0) : 0;
      if (agentBalance < orderBase) {
        throw new Error(
          `رصيد الوكيل غير كافٍ — الرصيد: ${fmt(agentBalance)} د.ع، الطلب: ${fmt(orderBase)} د.ع`
        );
      }
    }

    const now = new Date().toISOString();
    const shortId = orderId.slice(-6).toUpperCase();

    // تحديث الطلب
    transaction.update(orderRef, {
      driverId:        driver.id,
      driverName:      driver.name,
      driverDeduction: orderBase,
      agentDeduction:  order.agentId ? orderBase : 0,
      orderBase,
      status:          'في التوصيل',
      assignedAt:      now
    });

    // استقطاع رصيد السائق
    transaction.update(driverRef, { balance: increment(-orderBase), updatedAt: now });
    transaction.set(driverDeductRef, {
      driverId: driver.id, amount: orderBase, orderId,
      note: `طلب #${shortId}`, createdAt: now
    });

    // استقطاع رصيد الوكيل
    if (agentRef) {
      transaction.update(agentRef, { balance: increment(-orderBase), updatedAt: now });
      transaction.set(agentDeductRef, {
        agentId: order.agentId, amount: orderBase, orderId,
        note: `طلب #${shortId}`, createdAt: now
      });
    }

    capturedOrder = { ...order, driverId: driver.id, driverName: driver.name, orderBase };
  });

  // 🔔 إشعار تلجرام للسائق (بعد نجاح التحويل)
  if (capturedOrder) sendDriverTelegramNotification(capturedOrder, driver);
}

// ── Self-Process Order (agent handles delivery personally) ────────────────────
export async function selfProcessOrder(orderId, agent) {
  const orderSnap = await getDoc(doc(db, 'orders', orderId));
  if (!orderSnap.exists()) throw new Error('الطلب غير موجود');
  const order = { id: orderId, ...orderSnap.data() };

  if (!['جديد', 'قيد التجهيز'].includes(order.status)) {
    throw new Error('لا يمكن معالجة هذا الطلب بحالته الحالية');
  }

  const orderBase = order.orderBase ||
    ((order.items || []).reduce((s, i) => s + (i.price * i.quantity), 0) + (order.deliveryFee || 0));

  // التحقق من رصيد الوكيل
  const agentSnap  = await getDoc(doc(db, 'agents', agent.id));
  const agentBalance = (agentSnap.exists() ? agentSnap.data().balance : 0) || 0;
  if (agentBalance < orderBase) {
    const fmt = n => new Intl.NumberFormat('en-US').format(n);
    throw new Error(
      `رصيدك غير كافٍ — الرصيد الحالي: ${fmt(agentBalance)} د.ع، قيمة الطلب: ${fmt(orderBase)} د.ع`
    );
  }

  // تحديث الطلب
  await updateDoc(doc(db, 'orders', orderId), {
    driverId:        '__self__',
    driverName:      'معالجة ذاتية (الوكيل)',
    selfProcessed:   true,
    driverDeduction: 0,
    agentDeduction:  orderBase,
    orderBase,
    status:          'في التوصيل',
    assignedAt:      new Date().toISOString()
  });

  // استقطاع رصيد الوكيل
  await updateDoc(doc(db, 'agents', agent.id), {
    balance:   increment(-orderBase),
    updatedAt: new Date().toISOString()
  });
  await addDoc(collection(db, 'balance_deductions'), {
    agentId:   agent.id,
    amount:    orderBase,
    orderId,
    note: `طلب #${orderId.slice(-6).toUpperCase()} — معالجة ذاتية`,
    createdAt: new Date().toISOString()
  });

  return { ...order, selfProcessed: true, driverName: 'معالجة ذاتية (الوكيل)', orderBase };
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

// ── Real-time listener for a single order (for customer tracking) ──
export function listenToOrder(orderId, callback) {
  return onSnapshot(doc(db, 'orders', orderId), (snap) => {
    if (snap.exists()) callback({ id: snap.id, ...snap.data() });
  });
}

// ── Format price ──
export function formatPrice(n) {
  return new Intl.NumberFormat('en-US').format(n) + ' د.ع';
}
