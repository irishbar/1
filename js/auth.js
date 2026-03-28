// ============================================
// auth.js — Authentication Module
// ============================================
import { auth, db } from './firebase-config.js';
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import {
  doc, setDoc, getDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ── Auth State Observer ──
export function onAuthChange(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      const profile = await getUserProfile(user.uid);
      callback(user, profile);
    } else {
      callback(null, null);
    }
  });
}

// ── Register ──
export async function register({ name, email, password }) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    name,
    email,
    role: 'customer',   // default role
    createdAt: new Date().toISOString()
  });
  return cred.user;
}

// ── Login ──
export async function login({ email, password }) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ── Logout ──
export async function logout() {
  await signOut(auth);
}

// ── Get User Profile ──
export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, 'users', uid));
  if (!snap.exists()) return null;
  return { uid, ...snap.data() };
}

// ── Role Guards ──
export function requireRole(profile, allowedRoles) {
  return profile && allowedRoles.includes(profile.role);
}

// Roles: 'admin' | 'manager' | 'customer'
