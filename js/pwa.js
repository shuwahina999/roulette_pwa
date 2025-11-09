const installButton = document.getElementById('installButton');
let deferredPrompt = null;

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

const updateInstallButton = () => {
  if (!installButton) return;
  const shouldShow = !isStandalone();
  installButton.hidden = !shouldShow;
  installButton.disabled = !deferredPrompt;
};

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
  updateInstallButton();
});

window.addEventListener('appinstalled', () => {
  deferredPrompt = null;
  updateInstallButton();
});

if (installButton) {
  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    installButton.disabled = true;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome !== 'accepted') {
      installButton.disabled = false;
    }
    deferredPrompt = null;
    updateInstallButton();
  });
}

const monitorDisplayMode = () => {
  ['fullscreen', 'standalone', 'minimal-ui'].forEach((mode) => {
    window.matchMedia(`(display-mode: ${mode})`).addEventListener('change', updateInstallButton);
  });
  window.matchMedia('(display-mode: standalone)').addEventListener('change', updateInstallButton);
};

const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    if (registration.waiting) {
      registration.waiting.postMessage('skipWaiting');
    }
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      updateInstallButton();
    });
  } catch (error) {
    console.error('Service Worker registration failed:', error);
  }
};

window.addEventListener('DOMContentLoaded', () => {
  monitorDisplayMode();
  updateInstallButton();
  registerServiceWorker();
});
