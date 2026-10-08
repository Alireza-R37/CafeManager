import { getTeamDirectory, signInWithEmail } from "../auth.js";
import { avatarHTML, toast } from "../ui.js";
import { CAFE_NAME } from "../config.js";

export async function renderLogin(container, onSuccess) {
  container.innerHTML = `<div class="login-screen"><div class="empty-state"><div class="big">☕</div><p>در حال بارگذاری تیم…</p></div></div>`;
  let team = [];
  try { team = await getTeamDirectory(); }
  catch (e) {
    container.innerHTML = `<div class="login-screen" style="text-align:center"><p class="dim">اتصال به سرور برقرار نشد.</p><p class="hint mt-2">آدرس و کلید Supabase رو در js/config.js چک کن.</p></div>`;
    return;
  }
  let selected = null;
  function draw() {
    container.innerHTML = `
      <div class="login-screen">
        <div class="login-hero"><div class="mark">☕</div><h1>${CAFE_NAME}</h1><p>اسمت رو انتخاب کن و وارد شو</p></div>
        <div class="barista-grid">
          ${team.map((p) => `<div class="barista-pick ${selected?.id === p.id ? "selected" : ""}" data-id="${p.id}">${avatarHTML(p, 44)}<div class="mt-2" style="font-weight:700">${p.name}</div></div>`).join("")}
        </div>
        ${selected ? `<div><label for="pw">رمز عبور</label><input id="pw" type="password" placeholder="••••" autofocus /><button class="btn btn-primary btn-block" id="loginBtn">ورود</button></div>` : ""}
      </div>`;
    container.querySelectorAll(".barista-pick").forEach((x) => x.addEventListener("click", () => { selected = team.find((p) => p.id === x.dataset.id); draw(); }));
    const btn = container.querySelector("#loginBtn");
    if (btn) {
      const submit = async () => {
        const pw = container.querySelector("#pw").value;
        if (!pw) return toast("رمز رو وارد کن");
        btn.disabled = true; btn.textContent = "در حال ورود…";
        try { await signInWithEmail(selected.email, pw); onSuccess(); }
        catch (e) { toast("رمز اشتباهه یا حساب فعال نیست"); btn.disabled = false; btn.textContent = "ورود"; }
      };
      btn.addEventListener("click", submit);
      container.querySelector("#pw").addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
    }
  }
  draw();
}
