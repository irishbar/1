// ============================================
// Firebase Configuration
// ⚠️  استبدل هذه القيم بقيم مشروعك من Firebase Console
// ============================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyA1jo8L1gLSsDkJa7k0p17SpMXV35d-VcQ",
  authDomain: "irish-a68ec.firebaseapp.com",
  projectId: "irish-a68ec",
  storageBucket: "irish-a68ec.firebasestorage.app",
  messagingSenderId: "305458859946",
  appId: "1:305458859946:web:722d1f79633e0906e7a5d3"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ============================================
// Firestore Database Structure:
// 
// /users/{uid}          → { name, email, role: 'admin'|'manager'|'customer' }
// /categories/{id}      → { name, icon, order }
// /products/{id}        → { name, price, description, icon, categoryId, available }
// /orders/{id}          → { customerId, items[], total, status, createdAt, address }
// ============================================
