// Copy-to-clipboard for the connector URL on /connect/ (progressive, ~0.4 KB).
// Without JS the button stays hidden and the URL remains selectable text
// (select-all), so nothing breaks. With JS: one tap copies, label confirms.
(() => {
  for (const root of document.querySelectorAll("[data-copy]")) {
    const btn = root.querySelector("[data-copy-btn]");
    if (!btn || !navigator.clipboard) continue;
    btn.hidden = false;
    const idle = btn.textContent;
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(root.dataset.copy).then(() => {
        btn.textContent = btn.dataset.done || "Copied";
        setTimeout(() => (btn.textContent = idle), 1600);
      });
    });
  }
})();
