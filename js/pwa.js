const installButton = document.getElementById('installButton');
const updateButton = document.getElementById('updateApp');
let deferredPrompt = null;
let serviceWorkerRegistration = null;
let waitingServiceWorker = null;
let shouldReloadOnControllerChange = false;
let noUpdateToastTimeoutId = null;
let pendingReloadTimeoutId = null;

const dispatchToast = (message) => {
  if (!message) return;
  if (window.__toastEmitterReady) {
    window.dispatchEvent(new CustomEvent('app:toast', {
      detail: { message }
    }));
  } else {
    if (!Array.isArray(window.__pendingToasts)) {
      window.__pendingToasts = [];
    }
    window.__pendingToasts.push(message);
  }
};

const scheduleReload = (delay = 1000) => {
  if (pendingReloadTimeoutId) {
    window.clearTimeout(pendingReloadTimeoutId);
  }
  pendingReloadTimeoutId = window.setTimeout(() => {
    pendingReloadTimeoutId = null;
    window.location.reload();
  }, delay);
};

const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone;

const updateInstallButton = () => {
  if (!installButton) return;
  const shouldShow = !isStandalone();
  installButton.hidden = !shouldShow;
  installButton.disabled = !deferredPrompt;
};

const setUpdateButtonState = (state) => {
  if (!updateButton) return;
  updateButton.dataset.state = state;
  const shouldHighlight = state === 'ready';
  updateButton.classList.toggle('update-available', shouldHighlight);

  switch (state) {
    case 'idle':
      updateButton.textContent = 'アップデートを確認';
      updateButton.disabled = false;
      break;
    case 'checking':
      updateButton.textContent = '確認中...';
      updateButton.disabled = true;
      break;
    case 'ready':
      updateButton.textContent = '新しいバージョンを適用';
      updateButton.disabled = false;
      break;
    case 'updating':
      updateButton.textContent = '更新を適用中...';
      updateButton.disabled = true;
      break;
    case 'unsupported':
      updateButton.textContent = 'アップデート非対応';
      updateButton.disabled = true;
      break;
    case 'error':
      updateButton.textContent = 'アップデートに失敗しました';
      updateButton.disabled = true;
      break;
    default:
      updateButton.disabled = false;
  }

  if (!shouldHighlight) {
    updateButton.classList.remove('update-available');
  }
};

const notifyUpdateReady = (worker) => {
  if (!worker) return;
  if (noUpdateToastTimeoutId) {
    window.clearTimeout(noUpdateToastTimeoutId);
    noUpdateToastTimeoutId = null;
  }
  waitingServiceWorker = worker;
  setUpdateButtonState('ready');
  dispatchToast('新しいアップデートを適用できます');
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

if (updateButton) {
  updateButton.addEventListener('click', async () => {
    if (!('serviceWorker' in navigator)) return;

    if (pendingReloadTimeoutId) {
      window.clearTimeout(pendingReloadTimeoutId);
      pendingReloadTimeoutId = null;
    }

    if (waitingServiceWorker) {
      shouldReloadOnControllerChange = true;
      setUpdateButtonState('updating');
      dispatchToast('アップデートを適用しています...');
      if (noUpdateToastTimeoutId) {
        window.clearTimeout(noUpdateToastTimeoutId);
        noUpdateToastTimeoutId = null;
      }
      waitingServiceWorker.postMessage('skipWaiting');
      waitingServiceWorker = null;
      scheduleReload(5000);
      return;
    }

    if (noUpdateToastTimeoutId) {
      window.clearTimeout(noUpdateToastTimeoutId);
      noUpdateToastTimeoutId = null;
    }

    try {
      setUpdateButtonState('checking');
      if (!serviceWorkerRegistration) {
        serviceWorkerRegistration = await navigator.serviceWorker.ready;
      }
      await serviceWorkerRegistration.update();
    } catch (error) {
      console.error('Service Worker update check failed:', error);
      setUpdateButtonState('idle');
      dispatchToast('アップデートに失敗しました');
      if (pendingReloadTimeoutId) {
        window.clearTimeout(pendingReloadTimeoutId);
        pendingReloadTimeoutId = null;
      }
      return;
    }

    noUpdateToastTimeoutId = window.setTimeout(() => {
      noUpdateToastTimeoutId = null;
      if (!waitingServiceWorker) {
        setUpdateButtonState('idle');
        dispatchToast('アップデートはありません');
      }
    }, 800);
  });
}

const observeInstallingWorker = (worker, registration) => {
  if (!worker) return;
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed') {
      if (navigator.serviceWorker.controller) {
        notifyUpdateReady(registration.waiting || worker);
      } else {
        setUpdateButtonState('idle');
      }
    }
  });
};

const registerServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    setUpdateButtonState('unsupported');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('./sw.js');
    serviceWorkerRegistration = registration;

    if (registration.waiting) {
      notifyUpdateReady(registration.waiting);
    } else {
      setUpdateButtonState('idle');
    }

    observeInstallingWorker(registration.installing, registration);

    registration.addEventListener('updatefound', () => {
      observeInstallingWorker(registration.installing, registration);
    });

    navigator.serviceWorker.ready.then((readyRegistration) => {
      serviceWorkerRegistration = readyRegistration;
    }).catch(() => {
      /* no-op */
    });

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      waitingServiceWorker = null;
      updateInstallButton();
      if (noUpdateToastTimeoutId) {
        window.clearTimeout(noUpdateToastTimeoutId);
        noUpdateToastTimeoutId = null;
      }
      if (shouldReloadOnControllerChange) {
        shouldReloadOnControllerChange = false;
        setUpdateButtonState('idle');
        dispatchToast('アップデートに成功しました。まもなく再読み込みします。');
        scheduleReload(2200);
        return;
      }
      setUpdateButtonState('idle');
    });
  } catch (error) {
    console.error('Service Worker registration failed:', error);
    setUpdateButtonState('error');
    dispatchToast('アップデートに失敗しました');
    if (pendingReloadTimeoutId) {
      window.clearTimeout(pendingReloadTimeoutId);
      pendingReloadTimeoutId = null;
    }
  }
};

window.addEventListener('DOMContentLoaded', () => {
  monitorDisplayMode();
  updateInstallButton();

  if (!('serviceWorker' in navigator)) {
    setUpdateButtonState('unsupported');
    return;
  }

  setUpdateButtonState('checking');
  registerServiceWorker();
});
