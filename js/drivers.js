// ============================================
// drivers.js — Drivers & Balance Module
// ============================================
import { db } from './firebase-config.js';
import {
  collection, addDoc, getDocs, getDoc, doc,
  updateDoc, deleteDoc, query, where, orderBy, increment
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Default package settings (overridden by settings/packages in Firestore) ──
export let DRIVER_PAY_AMOUNT    = 15000;   // ما يدفعه السائق للوكيل
export let DRIVER_CREDIT_AMOUNT = 100000;  // الرصيد الذي يحصل عليه
export let AGENT_PAY_AMOUNT     = 8000;    // ما يدفعه الوكيل للمنصة
export let AGENT_CREDIT_AMOUNT  = 100000;  // الرصيد الذي يحصل عليه الوكيل
export let BALANCE_WARN_THRESH  = 20000;   // حد التحذير للرصيد المنخفض

// Load package settings from Firestore
export const packagesReady = (async () => {
  try {
    const snap = await getDoc(doc(db, 'settings', 'packages'));
    if (snap.exists()) {
      const d = snap.data();
      if (d.driverPayAmount    != null) DRIVER_PAY_AMOUNT    = d.driverPayAmount;
      if (d.driverCreditAmount != null) DRIVER_CREDIT_AMOUNT = d.driverCreditAmount;
      if (d.agentPayAmount     != null) AGENT_PAY_AMOUNT     = d.agentPayAmount;
      if (d.agentCreditAmount  != null) AGENT_CREDIT_AMOUNT  = d.agentCreditAmount;
      if (d.balanceWarnThresh  != null) BALANCE_WARN_THRESH  = d.balanceWarnThresh;
    }
  } catch {}
})();

// ─── Find driver linked to logged-in user ────────────────────────────────────
export async function findMyDriver(uid) {
  try {
    const q = query(collection(db, 'drivers'), where('userId', '==', uid));
    const snap = await getDocs(q);
    if (!snap.empty) return { id: snap.docs[0].id, ...snap.docs[0].data() };
  } catch {}
  return null;
}

// ─── Fetch all drivers under an agent ────────────────────────────────────────
export async function fetchDriversByAgent(agentId) {
  try {
    const q = query(collection(db, 'drivers'), where('agentId', '==', agentId));
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

// ─── Add a new driver (by agent) ─────────────────────────────────────────────
export async function addDriver({ agentId, name, phone, userId = null, commissionRate = 15, telegramId = null }) {
  return await addDoc(collection(db, 'drivers'), {
    agentId,
    name,
    phone,
    userId,
    telegramId,
    commissionRate,
    balance: 0,
    active: true,
    createdAt: new Date().toISOString()
  });
}

// ─── Update driver info ───────────────────────────────────────────────────────
export async function updateDriver(id, data) {
  await updateDoc(doc(db, 'drivers', id), {
    ...data,
    updatedAt: new Date().toISOString()
  });
}

// ─── Delete driver ────────────────────────────────────────────────────────────
export async function deleteDriver(id) {
  await deleteDoc(doc(db, 'drivers', id));
}

// ─── Top-up driver balance (called by agent) ──────────────────────────────────
export async function topUpDriverBalance(driverId, creditAmount, paidAmount, agentId, note = '') {
  await updateDoc(doc(db, 'drivers', driverId), {
    balance: increment(creditAmount),
    updatedAt: new Date().toISOString()
  });
  await addDoc(collection(db, 'balance_topups'), {
    targetId:     driverId,
    targetType:   'driver',
    agentId,
    creditAmount,
    paidAmount,
    note,
    createdAt:    new Date().toISOString()
  });
}

// ─── Top-up agent balance (called by admin) ───────────────────────────────────
export async function topUpAgentBalance(agentId, creditAmount, paidAmount, note = '') {
  await updateDoc(doc(db, 'agents', agentId), {
    balance: increment(creditAmount),
    updatedAt: new Date().toISOString()
  });
  await addDoc(collection(db, 'balance_topups'), {
    targetId:     agentId,
    targetType:   'agent',
    creditAmount,
    paidAmount,
    note,
    createdAt:    new Date().toISOString()
  });
}

// ─── Deduct from driver balance per order ────────────────────────────────────
export async function deductDriverBalance(driverId, amount, orderId = null) {
  await updateDoc(doc(db, 'drivers', driverId), {
    balance: increment(-Math.abs(amount)),
    updatedAt: new Date().toISOString()
  });
  if (orderId) {
    await addDoc(collection(db, 'balance_deductions'), {
      driverId,
      amount,
      orderId,
      createdAt: new Date().toISOString()
    });
  }
}

// ─── Fetch top-up history for a driver or agent ───────────────────────────────
export async function fetchTopupHistory(targetId) {
  try {
    const q = query(
      collection(db, 'balance_topups'),
      where('targetId', '==', targetId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

// ─── Fetch deduction history for a driver ────────────────────────────────────
export async function fetchDeductionHistory(driverId) {
  try {
    const q = query(
      collection(db, 'balance_deductions'),
      where('driverId', '==', driverId),
      orderBy('createdAt', 'desc')
    );
    const snap = await getDocs(q);
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
export function balanceColor(balance) {
  if (balance <= 0)      return '#ef4444';  // red
  if (balance < 20000)   return '#f59e0b';  // amber
  if (balance < 50000)   return '#3b82f6';  // blue
  return '#2d6a4f';                          // green
}

export function formatAmt(n) {
  return new Intl.NumberFormat('en-US').format(n) + ' د.ع';
}
