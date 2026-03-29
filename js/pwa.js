/* =============================================
   Irish Bar — PWA: Service Worker + Install + Notifications
   ============================================= */

(function () {
  'use strict';

  // ── 1. Register Service Worker ─────────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' })
        .then(reg => {
          console.log('[PWA] Service Worker registered', reg.scope);

          // Check for SW updates every 60 seconds
          setInterval(() => reg.update(), 60000);

          // Notify app when new SW is waiting
          reg.addEventListener('updatefound', () => {
            const newWorker = reg.installing;
            if (!newWorker) return;
            newWorker.addEventListener('statechange', () => {
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                showUpdateBanner();
              }
            });
          });
        })
        .catch(err => console.warn('[PWA] SW registration failed:', err));

      // Listen to SW messages
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.type === 'SYNC_ORDERS') {
          console.log('[PWA] Background sync triggered');
        }
      });
    });
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
        <img src="/icon-192.png" class="pwa-banner-icon" alt="Irish Bar">
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

  // ── 3. Update Banner ───────────────────────────────────────────────────
  function showUpdateBanner() {
    if (document.getElementById('pwa-update-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'pwa-update-banner';
    banner.innerHTML = `
      <div class="pwa-update-inner">
        <span>🔄 تحديث جديد متاح</span>
        <button id="pwaUpdateBtn">تحديث الآن</button>
        <button id="pwaUpdateDismiss" aria-label="إغلاق">✕</button>
      </div>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwaUpdateBtn').addEventListener('click', () => {
      banner.remove();
      navigator.serviceWorker.getRegistration().then(reg => {
        if (reg && reg.waiting) {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        window.location.reload();
      });
    });

    document.getElementById('pwaUpdateDismiss').addEventListener('click', () => banner.remove());
  }

  // ── 4. Push Notification Permission ────────────────────────────────────
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
        icon: '/icon-192.png',
        badge: '/icon-192.png',
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
