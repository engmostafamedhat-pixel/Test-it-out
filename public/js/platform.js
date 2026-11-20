// Platform detection for iPhone/iPad-specific safeguards.
// iOS Safari has no install prompt and no background sync, and data saved in
// a Safari tab is NOT visible to the home-screen app (separate storage).

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS reports as Mac

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;

// Unsent-report count on the home-screen icon. iOS 16.4+ shows it only for
// home-screen apps with notification permission; Android/desktop need none.
export async function setBadge(count) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (count > 0) await navigator.setAppBadge(count);
    else await navigator.clearAppBadge();
  } catch { /* permission not granted or unsupported */ }
}

export const badgeSupported = () => 'setAppBadge' in navigator;

export async function requestBadgePermission() {
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  return Notification.requestPermission();
}

export async function storagePersisted() {
  try {
    return (await navigator.storage?.persisted?.()) ?? null;
  } catch {
    return null;
  }
}
