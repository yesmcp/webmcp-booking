// Article share behaviour (progressive enhancement, ~0.5 KB).
// 1. Where the Web Share API exists (macOS Safari, iOS, Android, Windows
//    Chrome), a native "Share" button appears and opens the OS share sheet —
//    the system popup with a proper preview card.
// 2. The plain platform links stay as the universal fallback; with JS running
//    they open a compact popup window (the platform's composer, which renders
//    our OG card) instead of a full-tab redirect.
// Without JS nothing changes: the links keep working as normal anchors.
(() => {
  const root = document.querySelector("[data-share]");
  if (!root) return;

  const nativeBtn = root.querySelector("[data-share-native]");
  if (nativeBtn && navigator.share) {
    nativeBtn.hidden = false;
    nativeBtn.addEventListener("click", () => {
      navigator
        .share({ title: root.dataset.title, url: root.dataset.url })
        .catch(() => {});
    });
  }

  for (const a of root.querySelectorAll("a[data-share-link]")) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      window.open(a.href, "_blank", "noopener,width=620,height=620");
    });
  }
})();
