import { getSession, loadProfile, getCurrentProfile, signOut, onAuthChange } from "./auth.js";
import { renderLogin } from "./views/login.js";
import { renderSchedule } from "./views/schedule.js";
import { renderSwap } from "./views/swap.js";
import { renderChecklist } from "./views/checklist.js";
import { renderAdmin } from "./views/admin.js";
import { CAFE_NAME } from "./config.js";
import { avatarHTML } from "./ui.js";

const app = document.getElementById("app");

const ICONS = {
  schedule: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>`,
  swap: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>`,
  checklist: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h4M4 12h4M4 18h4M11 6h9M11 12h9M11 18h9"/></svg>`,
  admin: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.55V21a2 2 0 0 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1 1.55 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0 1.55 1H21a2 2 0 0 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z"/></svg>`,
};

const TABS = [
  { key: "schedule", label: "برنامه", render: renderSchedule },
  { key: "swap", label: "جایگزینی", render: renderSwap },
  { key: "checklist", label: "چک‌لیست", render: renderChecklist },
];

function currentTabKey() {
  return (location.hash.replace("#/", "") || "schedule").split("?")[0];
}

async function renderShell() {
  const me = getCurrentProfile();
  const isAdmin = me?.role === "admin";

  // ادمین صفحه‌ی «انتخاب شیفت» رو نمی‌بینه؛ فقط مدیریت + جایگزینی + چک‌لیست
  const tabs = isAdmin
    ? [{ key: "admin", label: "مدیریت", render: renderAdmin }, ...TABS.filter((t) => t.key !== "schedule")]
    : [...TABS];

  const fallbackKey = isAdmin ? "admin" : "schedule";
  const activeKey = tabs.some((t) => t.key === currentTabKey()) ? currentTabKey() : fallbackKey;
  const activeTab = tabs.find((t) => t.key === activeKey);

  app.innerHTML = `
    <div class="topbar">
      <div>
        <h1>${CAFE_NAME}</h1>
        <div class="sub">سلام ${me?.name || ""} 👋</div>
      </div>
      <button id="logoutBtn" class="btn btn-ghost btn-sm">خروج</button>
    </div>
    <div class="view" id="view"></div>
    <nav class="tabbar">
      ${tabs.map((t) => `
        <button data-tab="${t.key}" class="${t.key === activeKey ? "active" : ""}">
          ${ICONS[t.key]}
          <span>${t.label}</span>
        </button>`).join("")}
    </nav>
  `;

  document.getElementById("logoutBtn").addEventListener("click", async () => {
    await signOut();
    boot();
  });

  app.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => { location.hash = `#/${btn.dataset.tab}`; });
  });

  const viewEl = document.getElementById("view");
  await activeTab.render(viewEl);
}

window.addEventListener("hashchange", () => {
  if (getCurrentProfile()) renderShell();
});

async function boot() {
  const session = await getSession();
  if (!session) {
    await renderLogin(app, async () => {
      const profile = await loadProfile();
      location.hash = profile?.role === "admin" ? "#/admin" : "#/schedule";
      renderShell();
    });
    return;
  }
  try {
    await loadProfile();
    renderShell();
  } catch (e) {
    await signOut();
    boot();
  }
}

onAuthChange((session) => {
  if (!session && getCurrentProfile()) boot();
});

boot();
