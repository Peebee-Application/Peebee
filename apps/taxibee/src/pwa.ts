type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISS_KEY = "taxibee-install-dismissed-at";
const DISMISS_MS = 7 * 24 * 60 * 60 * 1000;

function standalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function wasDismissed(): boolean {
  try {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_MS;
  } catch {
    return false;
  }
}

export function installPwa() {
  const prompt = document.getElementById("pwa-install-prompt");
  const message = document.getElementById("pwa-install-message");
  const installButton = document.getElementById("pwa-install-button") as HTMLButtonElement | null;
  const dismissButton = document.getElementById("pwa-install-dismiss");
  if (!prompt || !message || !installButton || !dismissButton) return;

  if ("serviceWorker" in navigator && window.isSecureContext) {
    void navigator.serviceWorker.register("/push-sw.js", { scope: "/" }).catch(() => {
      // Installation and push can be retried by the browser on the next visit.
    });
  }

  if (standalone() || wasDismissed()) return;
  let deferred: InstallPromptEvent | null = null;
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);

  const dismiss = () => {
    prompt.classList.add("is-hidden");
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* Storage can be disabled. */ }
  };

  if (isIos) {
    message.textContent = 'In Safari, tap Share, then “Add to Home Screen”.';
    prompt.classList.remove("is-hidden");
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    if (standalone() || wasDismissed()) return;
    event.preventDefault();
    deferred = event as InstallPromptEvent;
    message.textContent = "Add Taxibee to your home screen for quick access.";
    installButton.classList.remove("is-hidden");
    prompt.classList.remove("is-hidden");
  });

  window.addEventListener("appinstalled", () => prompt.classList.add("is-hidden"));
  dismissButton.addEventListener("click", dismiss);
  installButton.addEventListener("click", async () => {
    if (!deferred) return;
    const choice = deferred;
    deferred = null;
    await choice.prompt();
    await choice.userChoice;
    dismiss();
  });
}
