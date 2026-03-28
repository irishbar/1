// ============================================
// ui.js — Shared UI Utilities
// ============================================

// ── Toast Notifications ──
export function showToast(message, type = 'info', duration = 3000) {
  const container = document.getElementById('toast-container') 
    || createToastContainer();
  
  const icons = { success: '✅', error: '❌', info: '🍀', warning: '⚠️' };
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span>${icons[type]}</span><span>${message}</span>`;
  container.appendChild(toast);
  
  setTimeout(() => {
    toast.classList.add('hide');
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

function createToastContainer() {
  const el = document.createElement('div');
  el.id = 'toast-container';
  document.body.appendChild(el);
  return el;
}

// ── Modal ──
export function openModal(id) {
  document.getElementById(id)?.classList.add('active');
  document.body.style.overflow = 'hidden';
}
export function closeModal(id) {
  document.getElementById(id)?.classList.remove('active');
  document.body.style.overflow = '';
}

// ── Page Loader ──
export function showLoader()  { document.getElementById('page-loader')?.classList.remove('hidden'); }
export function hideLoader()  { document.getElementById('page-loader')?.classList.add('hidden'); }

// ── Format Price (Arabic) ──
export function formatPrice(n) {
 return new Intl.NumberFormat('en-US').format(n) + ' د.ع';
}

// ── Date Format ──
export function formatDate(isoStr) {
  if (!isoStr) return '—';
  return new Date(isoStr).toLocaleString('ar-IQ', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

// ── Confirm Dialog ──
export function confirm(message) {
  return window.confirm(message);
}

// ── Sidebar Toggle ──
export function setupSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.querySelector('.sidebar-overlay');
  const toggleBtn = document.getElementById('sidebarToggle');

  if (!sidebar) return;

  toggleBtn?.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay?.classList.toggle('show');
  });
  overlay?.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
  });
}

// ── Bottom Nav Routing ──
export function setupBottomNav(pages, renderFn) {
  const items = document.querySelectorAll('.bottom-nav-item');
  const navItems = document.querySelectorAll('.nav-item');

  function activate(pageId) {
    items.forEach(el => el.classList.toggle('active', el.dataset.page === pageId));
    navItems.forEach(el => el.classList.toggle('active', el.dataset.page === pageId));
    renderFn(pageId);
  }

  items.forEach(el => el.addEventListener('click', () => activate(el.dataset.page)));
  navItems.forEach(el => el.addEventListener('click', () => {
    activate(el.dataset.page);
    // Close sidebar on mobile
    document.querySelector('.sidebar')?.classList.remove('open');
    document.querySelector('.sidebar-overlay')?.classList.remove('show');
  }));

  // Activate first
  if (pages.length > 0) activate(pages[0]);
}

// ── Scroll to top ──
export function scrollTop() { window.scrollTo({ top: 0, behavior: 'smooth' }); }
