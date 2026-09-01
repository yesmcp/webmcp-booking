// Scroll-reveal for elements marked `.reveal`.
// Served as a static file on purpose: an external script on this origin is
// covered by `script-src 'self'` in public/_headers, whereas Astro would inline
// a bundle this small into the HTML and every page would then need its own CSP
// hash. See the comment block in _headers before changing this.
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    }
  },
  { threshold: 0.15 },
);

document.querySelectorAll(".reveal").forEach((el) => io.observe(el));
