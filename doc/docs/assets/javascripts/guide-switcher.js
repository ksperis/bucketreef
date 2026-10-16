(function () {
  "use strict";

  const match = window.location.pathname.match(
    /^(.*?)\/(admin|developer|manager|portal|browser)\/(en|fr)(?:\/|$)/,
  );

  if (!match) {
    return;
  }

  const [, basePath, currentGuide, currentLanguage] = match;
  const language = document.documentElement.lang === "fr" ? "fr" : "en";
  const labels =
    language === "fr"
      ? {
          administration: "Administration",
          developer: "Développeur",
          manager: "Manager",
          portal: "Portal",
          browser: "Browser",
          all: "Tous les guides",
          switchGuide: "Changer de guide",
          currentSuffix: "guide actuel",
        }
      : {
          administration: "Administration",
          developer: "Developer",
          manager: "Manager",
          portal: "Portal",
          browser: "Browser",
          all: "All guides",
          switchGuide: "Switch guide",
          currentSuffix: "current guide",
        };

  const guideNames = {
    admin: labels.administration,
    developer: labels.developer,
    manager: labels.manager,
    portal: labels.portal,
    browser: labels.browser,
  };

  const guidePaths = {
    admin: "/admin/en/",
    developer: "/developer/en/",
    manager: "/manager/en/",
    portal: currentGuide === "portal" && currentLanguage === "fr" ? "/portal/fr/" : "/portal/en/",
    browser: "/browser/en/",
  };

  const header = document.querySelector(".md-header__inner");
  const title = header?.querySelector(".md-header__title");

  if (!header || !title || header.querySelector(".docs-guide-switcher")) {
    return;
  }

  const details = document.createElement("details");
  details.className = "docs-guide-switcher";

  const summary = document.createElement("summary");
  summary.className = "docs-guide-switcher__summary";
  summary.setAttribute("aria-label", `${labels.switchGuide}: ${guideNames[currentGuide]}`);
  summary.innerHTML = `
    <svg class="docs-guide-switcher__icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h6v6H4V5Zm10 0h6v6h-6V5ZM4 15h6v4H4v-4Zm10 0h6v4h-6v-4Z"></path>
    </svg>
    <span class="docs-guide-switcher__label">${guideNames[currentGuide]}</span>
    <span class="docs-guide-switcher__chevron" aria-hidden="true"></span>
  `;

  const menu = document.createElement("div");
  menu.className = "docs-guide-switcher__menu";
  menu.setAttribute("role", "menu");

  Object.entries(guidePaths).forEach(([guide, path]) => {
    const link = document.createElement("a");
    link.className = "docs-guide-switcher__link";
    link.href = `${basePath}${path}`;
    link.setAttribute("role", "menuitem");
    link.textContent = guideNames[guide];

    if (guide === currentGuide) {
      link.classList.add("docs-guide-switcher__link--current");
      link.setAttribute("aria-current", "page");
      link.setAttribute("aria-label", `${guideNames[guide]}, ${labels.currentSuffix}`);
    }

    menu.appendChild(link);
  });

  const separator = document.createElement("div");
  separator.className = "docs-guide-switcher__separator";
  separator.setAttribute("role", "separator");
  menu.appendChild(separator);

  const allGuides = document.createElement("a");
  allGuides.className = "docs-guide-switcher__link docs-guide-switcher__link--all";
  allGuides.href = `${basePath || ""}/`;
  allGuides.setAttribute("role", "menuitem");
  allGuides.textContent = `← ${labels.all}`;
  menu.appendChild(allGuides);

  details.append(summary, menu);
  title.insertAdjacentElement("afterend", details);

  document.addEventListener("click", (event) => {
    if (details.open && !details.contains(event.target)) {
      details.open = false;
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && details.open) {
      details.open = false;
      summary.focus();
    }
  });
})();
