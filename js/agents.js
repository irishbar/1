// ─── Constants (defaults — overridden by Firestore settings/agents) ───────────
export let AGENT_COVERAGE_KM         = 8;
export let AGENT_COMMISSION_RATE      = 0.35;      // 35% default (decimal)
export let AGENT_COMMISSION_TYPE      = 'percent'; // 'percent' | 'fixed'
export let PLATFORM_COMMISSION_TYPE   = 'percent'; // 'percent' | 'fixed'
export let PLATFORM_COMMISSION_VALUE  = null;      // null = remainder after agent

// Load dynamic settings from Firestore on startup
import { db } from './firebase-config.js';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, setDoc, getDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

(async () => {
  try {
    const snap = await getDoc(doc(db, 'settings', 'agents'));
    if (snap.exists()) {
      const d = snap.data();
      if (d.commissionRate           != null) AGENT_COMMISSION_RATE     = d.commissionRate / 100;
      if (d.commissionType           != null) AGENT_COMMISSION_TYPE     = d.commissionType;
      if (d.coverageKm               != null) AGENT_COVERAGE_KM         = d.coverageKm;
      if (d.platformCommissionType   != null) PLATFORM_COMMISSION_TYPE  = d.platformCommissionType;
      if (d.platformCommissionValue  != null) PLATFORM_COMMISSION_VALUE = d.platformCommissionValue;
    }
  } catch {}
})();

// ─── Haversine distance ───────────────────────
export function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat1 - lat2) * Math.PI / 180;
  const dLng = (lng1 - lng2) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat2*Math.PI/180) * Math.cos(lat1*Math.PI/180) *
            Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ─── Fetch all active agents ──────────────────
export async function fetchAgents() {
  try {
    const snap = await getDocs(collection(db, 'agents'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch { return []; }
}

// ─── Find nearest agent to a lat/lng ──────────
export function findNearestAgent(userLat, userLng, agents) {
  if (!agents || !agents.length) return null;
  let nearest = null; let minDist = Infinity;
  for (const a of agents) {
    if (!a.lat || !a.lng || a.active === false) continue;
    const d = haversineKm(userLat, userLng, a.lat, a.lng);
    if (d < minDist) { minDist = d; nearest = { ...a, distance: d }; }
  }
  return nearest;
}

// ─── Check coverage ───────────────────────────
export function getCoverageStatus(userLat, userLng, agents) {
  const nearest = findNearestAgent(userLat, userLng, agents);
  if (!nearest) return { covered: false, nearest: null, distance: null };
  // Use agent's own coverageKm if set, otherwise fall back to global setting
  const agentCoverage = nearest.coverageKm ?? AGENT_COVERAGE_KM;
  return {
    covered: nearest.distance <= agentCoverage,
    nearest,
    distance: nearest.distance
  };
}

// ─── Calculate profit split (agent can be passed for per-agent override) ───────
export function calcProfitSplit(deliveryFee, agent = null) {
  // Per-agent commission, fall back to global default
  const aType = agent?.commissionType ?? AGENT_COMMISSION_TYPE;
  const aVal  = agent?.commissionRate ?? (AGENT_COMMISSION_RATE * 100); // stored as %
  const agentShare = aType === 'fixed'
    ? Math.min(aVal, deliveryFee)
    : Math.round(deliveryFee * aVal / 100);

  // Platform commission
  let platformShare;
  if (PLATFORM_COMMISSION_VALUE != null) {
    if (PLATFORM_COMMISSION_TYPE === 'fixed') {
      platformShare = Math.min(PLATFORM_COMMISSION_VALUE, deliveryFee);
    } else {
      platformShare = Math.round(deliveryFee * PLATFORM_COMMISSION_VALUE / 100);
    }
  } else {
    platformShare = deliveryFee - agentShare;
  }
  return { agentShare, platformShare };
}

// ─── Register/update agent location ──────────
export async function saveAgentLocation(agentId, { lat, lng, address, name, phone }) {
  await setDoc(doc(db, 'agents', agentId), {
    lat, lng, address, name, phone,
    active: true,
    updatedAt: new Date().toISOString()
  }, { merge: true });
}

// ─── Real-time listener for agents ───────────
export function listenToAgents(callback) {
  return onSnapshot(collection(db, 'agents'), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ─── Add agent ────────────────────────────────
export async function addAgent(data) {
  return await addDoc(collection(db, 'agents'), {
    ...data, active: true, createdAt: new Date().toISOString()
  });
}

// ─── Update agent ──────────────────────────────
export async function updateAgent(id, data) {
  await updateDoc(doc(db, 'agents', id), { ...data, updatedAt: new Date().toISOString() });
}

// ─── Delete agent ─────────────────────────────
export async function deleteAgent(id) {
  await deleteDoc(doc(db, 'agents', id));
}
