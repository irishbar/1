// ============================================
// store.js — Store Module (Products, Categories, Cart)
// ============================================
import { db } from './firebase-config.js';
import {
  collection, getDocs, addDoc, updateDoc, deleteDoc,
  doc, query, orderBy, where, onSnapshot, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// ──────────────────────────────────────────
// CATEGORIES
// ──────────────────────────────────────────
export async function fetchCategories() {
  const q = query(collection(db, 'categories'), orderBy('order', 'asc'));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addCategory({ name, icon, order }) {
  return await addDoc(collection(db, 'categories'), { name, icon, order });
}

export async function deleteCategory(id) {
  await deleteDoc(doc(db, 'categories', id));
}

// ──────────────────────────────────────────
// PRODUCTS
// ──────────────────────────────────────────
export async function fetchProducts(categoryId = null) {
  let q;
  if (categoryId) {
    q = query(collection(db, 'products'), where('categoryId', '==', categoryId));
  } else {
    q = query(collection(db, 'products'), orderBy('name'));
  }
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function addProduct({ name, price, description, emoji, imageUrl = '', categoryId, available = true, unavailableFrom = null, unavailableUntil = null, costPrice = 0 }) {
  const data = { name, price: Number(price), description, emoji, imageUrl, categoryId, available };
  if (costPrice) data.costPrice = Number(costPrice);
  if (unavailableFrom)  data.unavailableFrom  = unavailableFrom;
  if (unavailableUntil) data.unavailableUntil = unavailableUntil;
  return await addDoc(collection(db, 'products'), data);
}

export async function updateProduct(id, data) {
  await updateDoc(doc(db, 'products', id), data);
}

export async function deleteProduct(id) {
  await deleteDoc(doc(db, 'products', id));
}

// ──────────────────────────────────────────
// DELIVERY SETTINGS (admin controls)
// ──────────────────────────────────────────
export async function fetchDeliverySettings() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'delivery'));
    if (snap.exists()) return snap.data();
    // defaults: 1000 IQD per km, min 1000, center = Karbala
    return {
      centerLat: 32.6136,
      centerLng: 44.0092,
      pricePerKm: 1000,
      minFee: 1000
    };
  } catch { return null; }
}

export async function saveDeliverySettings(data) {
  await setDoc(doc(db, 'settings', 'delivery'), data);
}

export function calcDeliveryFee(userLat, userLng, settings) {
  if (!settings) return 0;
  const R = 6371;
  const dLat = (userLat - settings.centerLat) * Math.PI / 180;
  const dLng = (userLng - settings.centerLng) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(settings.centerLat * Math.PI/180) *
            Math.cos(userLat * Math.PI/180) *
            Math.sin(dLng/2)**2;
  const km = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const fee = Math.ceil(km) * (settings.pricePerKm ?? 1000);
  return Math.max(fee, settings.minFee ?? 1000);
}

export function calcDistance(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat1 - lat2) * Math.PI / 180;
  const dLng = (lng1 - lng2) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat2*Math.PI/180)*Math.cos(lat1*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ──────────────────────────────────────────
// CART (localStorage)
// ──────────────────────────────────────────
const CART_KEY = 'irishbar_cart';

export function getCart() {
  try { return JSON.parse(localStorage.getItem(CART_KEY)) || []; }
  catch { return []; }
}

export function saveCart(cart) {
  localStorage.setItem(CART_KEY, JSON.stringify(cart));
}

export function addToCart(product) {
  const cart = getCart();
  const idx  = cart.findIndex(i => i.id === product.id);
  if (idx >= 0) {
    cart[idx].quantity++;
  } else {
    cart.push({ ...product, quantity: 1 });
  }
  saveCart(cart);
  return cart;
}

export function updateCartQty(productId, qty) {
  let cart = getCart();
  if (qty <= 0) {
    cart = cart.filter(i => i.id !== productId);
  } else {
    const item = cart.find(i => i.id === productId);
    if (item) item.quantity = qty;
  }
  saveCart(cart);
  return cart;
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
}

export function getCartTotal(cart) {
  return cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
}

export function getCartCount(cart) {
  return cart.reduce((sum, i) => sum + i.quantity, 0);
}
