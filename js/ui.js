import { initials, colorFromString, periodLabel } from "./utils.js";

let toastTimer;
export function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

export function avatarHTML(profile, size = 28) {
  if (!profile) return `<span class="avatar" style="background:#46352770;width:${size}px;height:${size}px">؟</span>`;
  const bg = profile.color || colorFromString(profile.name);
  return `<span class="avatar" style="background:${bg};width:${size}px;height:${size}px">${initials(profile.name)}</span>`;
}

export function periodChipHTML(period) {
  return `<span class="chip chip-${period}"><span class="dot dot-${period}"></span>${periodLabel(period)}</span>`;
}

export async function confirmAction(message) {
  return window.confirm(message);
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
