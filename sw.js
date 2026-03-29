self.addEventListener('push', function(event) {
  const options = {
    body: event.data.text(),
    icon: 'icon-192.png',
    badge: 'icon-192.png'
  };
  event.waitUntil(
    self.registration.showNotification('Irish Bar', options)
  );
});