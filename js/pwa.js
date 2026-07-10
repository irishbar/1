/* =============================================
   Irish Bar — PWA: Service Worker + Install + Notifications
   ============================================= */

(function () {
  'use strict';

  // ── 1. Register Service Worker ─────────────────────────────────────────
  const BASE_PATH = (function() {
    const scripts = document.querySelectorAll('script[src]');
    for (const s of scripts) {
      if (s.src.includes('/js/pwa.js')) return s.src.replace('/js/pwa.js', '/');
    }
    const loc = window.location.href;
    return loc.substring(0, loc.lastIndexOf('/') + 1);
  })();

  // ── Auto-update: reload when new SW takes over ─────────────────────────
  // Track whether a SW was already controlling this page BEFORE registration
  const _hadController = !!navigator.serviceWorker.controller;
  let _reloadPending = false;

  if ('serviceWorker' in navigator) {
    // When a new SW activates and claims this client → auto-reload
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!_hadController) return; // first install on this device, skip
      if (_reloadPending) return;
      _reloadPending = true;

      if (document.hidden) {
        // App is in background — reload silently
        window.location.reload();
      } else {
        // App is in foreground — brief bar then auto-reload (no button needed)
        _showAutoUpdateBar();
      }
    });

    // If app comes back to foreground while a reload is pending, do it then
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && _reloadPending) window.location.reload();
    });

    window.addEventListener('load', () => {
      const swUrl = BASE_PATH + 'sw.js';
      navigator.serviceWorker.register(swUrl, { scope: BASE_PATH })
        .then(reg => {
          // Immediate update check on load + every 30 seconds
          reg.update().catch(() => {});
          setInterval(() => reg.update().catch(() => {}), 30000);
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err));

      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'SYNC_ORDERS') {
          console.log('[PWA] Background sync triggered');
        }
      });
    });
  }

  function _showAutoUpdateBar() {
    const bar = document.createElement('div');
    bar.style.cssText = [
      'position:fixed;top:0;left:0;right:0;z-index:999999',
      'background:linear-gradient(90deg,#1a3d28,#2d6a4f)',
      'color:#fff;padding:10px 20px;text-align:center',
      'font-size:0.85rem;font-weight:700;font-family:sans-serif',
      'box-shadow:0 2px 12px rgba(0,0,0,0.4)',
    ].join(';');
    bar.textContent = '🔄 تحديث جديد — سيتم التحديث تلقائياً...';
    document.body.prepend(bar);
    // Count down 2 seconds then reload — enough time for user to see
    setTimeout(() => window.location.reload(), 2000);
  }

  // ── 2. Install Banner ──────────────────────────────────────────────────
  let deferredPrompt = null;
  const DISMISSED_KEY = 'pwa_install_dismissed';

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    // Don't show if already installed or recently dismissed
    if (isStandalone()) return;
    const dismissed = localStorage.getItem(DISMISSED_KEY);
    if (dismissed && Date.now() - parseInt(dismissed) < 7 * 24 * 60 * 60 * 1000) return;

    // Wait a bit before showing (better UX)
    setTimeout(showInstallBanner, 3000);
  });

  function isStandalone() {
    return (
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true ||
      document.referrer.includes('android-app://')
    );
  }

  function showInstallBanner() {
    if (document.getElementById('pwa-install-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-label', 'تثبيت التطبيق');
    banner.innerHTML = `
      <div class="pwa-banner-inner">
        <img src="${BASE_PATH}icon-192.png" class="pwa-banner-icon" alt="Irish Bar">
        <div class="pwa-banner-text">
          <div class="pwa-banner-title">ثبّت التطبيق</div>
          <div class="pwa-banner-sub">تجربة أسرع • يعمل بدون إنترنت • إشعارات فورية</div>
        </div>
        <div class="pwa-banner-actions">
          <button class="pwa-install-btn" id="pwaInstallBtn">تثبيت</button>
          <button class="pwa-dismiss-btn" id="pwaDismissBtn" aria-label="إغلاق">✕</button>
        </div>
      </div>
    `;

    document.body.appendChild(banner);

    // Animate in
    requestAnimationFrame(() => {
      requestAnimationFrame(() => banner.classList.add('pwa-banner-visible'));
    });

    document.getElementById('pwaInstallBtn').addEventListener('click', installApp);
    document.getElementById('pwaDismissBtn').addEventListener('click', dismissBanner);
  }

  function installApp() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then(choice => {
      if (choice.outcome === 'accepted') {
        hideBanner();
        requestNotificationPermission();
      } else {
        dismissBanner();
      }
      deferredPrompt = null;
    });
  }

  function dismissBanner() {
    localStorage.setItem(DISMISSED_KEY, Date.now().toString());
    hideBanner();
  }

  function hideBanner() {
    const banner = document.getElementById('pwa-install-banner');
    if (!banner) return;
    banner.classList.remove('pwa-banner-visible');
    setTimeout(() => banner.remove(), 400);
  }

  // ── 3. Push Notification Permission ────────────────────────────────────
  function requestNotificationPermission() {
    if (!('Notification' in window)) return;
    if (Notification.permission === 'granted') return;
    if (Notification.permission === 'denied') return;

    // Ask after a small delay
    setTimeout(() => {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') {
          showLocalNotification('Irish Bar', 'تم تفعيل الإشعارات بنجاح! 🥃');
        }
      });
    }, 1500);
  }

  // Ask for notifications when already installed as PWA
  if (isStandalone()) {
    window.addEventListener('load', () => {
      setTimeout(requestNotificationPermission, 5000);
    });
  }

  // ── 5. Local Notification helper ───────────────────────────────────────
  function showLocalNotification(title, body) {
    if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
    navigator.serviceWorker.ready.then(reg => {
      reg.showNotification(title, {
        body,
        icon: BASE_PATH + 'icon-192.png',
        badge: BASE_PATH + 'icon-192.png',
        vibrate: [200, 100, 200],
        tag: 'irish-bar-local',
      });
    });
  }

  // Expose for external use
  window.pwa = {
    requestNotifications: requestNotificationPermission,
    showNotification: showLocalNotification,
    isInstalled: isStandalone,
  };

  // ── 6. iOS Install Hint ─────────────────────────────────────────────────
  function isIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  }

  if (isIOS() && !isStandalone()) {
    const IOS_KEY = 'pwa_ios_hint_shown';
    const shown = localStorage.getItem(IOS_KEY);
    if (!shown) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const hint = document.createElement('div');
          hint.id = 'pwa-ios-hint';
          hint.innerHTML = `
            <div class="pwa-ios-inner">
              <button class="pwa-ios-close" id="pwaIosClose">✕</button>
              <div class="pwa-ios-title">لتثبيت التطبيق على iPhone</div>
              <div class="pwa-ios-steps">
                <div class="pwa-ios-step"><span class="pwa-ios-num">١</span> اضغط على زر المشاركة <strong>⎙</strong></div>
                <div class="pwa-ios-step"><span class="pwa-ios-num">٢</span> اختر <strong>"إضافة إلى الشاشة الرئيسية"</strong></div>
                <div class="pwa-ios-step"><span class="pwa-ios-num">٣</span> اضغط <strong>"إضافة"</strong></div>
              </div>
              <div class="pwa-ios-arrow"></div>
            </div>
          `;
          document.body.appendChild(hint);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => hint.classList.add('pwa-ios-visible'));
          });

          document.getElementById('pwaIosClose').addEventListener('click', () => {
            localStorage.setItem(IOS_KEY, '1');
            hint.classList.remove('pwa-ios-visible');
            setTimeout(() => hint.remove(), 400);
          });
        }, 4000);
      });
    }
  }

})();
