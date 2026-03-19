function toggleMenu() {
  document.getElementById("mobileMenu").classList.toggle("open");
}

// Smooth scroll
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const target = document.querySelector(a.getAttribute("href"));
    if (target) { e.preventDefault(); target.scrollIntoView({ behavior: "smooth", block: "start" }); }
  });
});

// Subtle entrance animations
const observer = new IntersectionObserver(
  (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("visible"); observer.unobserve(e.target); } }),
  { threshold: 0.1 }
);
document.querySelectorAll(".project, .value").forEach((el) => {
  el.style.opacity = "0";
  el.style.transform = "translateY(20px)";
  el.style.transition = "opacity 0.5s ease, transform 0.5s ease";
  observer.observe(el);
});
document.querySelectorAll(".project.visible, .value.visible").forEach(() => {});
// Re-check as class is added
const mo = new MutationObserver((mutations) => {
  mutations.forEach((m) => {
    if (m.type === "attributes" && m.attributeName === "class") {
      const el = m.target;
      if (el.classList.contains("visible")) {
        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
      }
    }
  });
});
document.querySelectorAll(".project, .value").forEach((el) => mo.observe(el, { attributes: true }));
