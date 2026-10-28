export const dynamic = "force-dynamic";

/**
 * The prediction overlay for live streams (vMix / OBS browser input, 1920×1080, transparent).
 * A plain page with no site header: it polls ./predict/data and animates the split, the payout per side,
 * the countdown to lock and the result. ?t=<tournament> pins a tournament, ?m=<match key> one match
 * (W1-0, or W1-0#2 for game 2), ?pos=top puts it at the top, ?scale=0.8 resizes it, ?preview=1 plays fake numbers.
 */
export function GET() {
  return new Response(HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

const HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1920, height=1080" />
<meta name="robots" content="noindex" />
<title>Prediction overlay</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@500;600;700&display=swap" rel="stylesheet" />
<style>
  :root { --red: #d9121f; --red-hi: #ff3b47; --blue: #2f7bff; --blue-hi: #6aa5ff; --ink: #fff; --muted: rgba(255,255,255,.72); --panel: rgba(12,12,16,.88); --line: rgba(255,255,255,.12); }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
  body { font-family: "IBM Plex Sans Thai Looped", "Leelawadee UI", "Tahoma", sans-serif; color: var(--ink); }
  .stage { position: absolute; left: 50%; width: 1240px; transform-origin: center bottom; }
  .stage.bottom { bottom: 54px; }
  .stage.top { top: 54px; transform-origin: center top; }
  .card { position: relative; border-radius: 22px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 18px 50px rgba(0,0,0,.55); padding: 18px 26px 20px; overflow: hidden;
    opacity: 0; transform: translateY(40px) scale(.98); transition: opacity .5s ease, transform .6s cubic-bezier(.2,1.3,.4,1); }
  .card.show { opacity: 1; transform: none; }
  .card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 4px; background: linear-gradient(90deg, var(--red), var(--blue)); }
  .head { display: flex; align-items: center; gap: 14px; font-size: 22px; }
  .tag { font-weight: 700; letter-spacing: .5px; }
  .title { color: var(--muted); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .state { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 20px; background: rgba(255,255,255,.08); white-space: nowrap; }
  .state.open { background: var(--red); animation: pulse 1.6s ease-in-out infinite; }
  .state.open::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #fff; animation: blink 1s steps(2) infinite; }
  .row { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 18px; margin-top: 14px; }
  .side { display: flex; align-items: center; gap: 14px; min-width: 0; transition: filter .4s, opacity .4s; }
  .side.b { flex-direction: row-reverse; text-align: right; }
  .logo { width: 64px; height: 64px; border-radius: 16px; background: rgba(255,255,255,.08) center/cover no-repeat; flex-shrink: 0; display: grid; place-items: center; font-weight: 700; font-size: 26px; border: 2px solid transparent; }
  .a .logo { border-color: var(--red); } .b .logo { border-color: var(--blue); }
  .name { font-size: 30px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .meta { font-size: 19px; color: var(--muted); }
  .vs { font-weight: 700; font-size: 22px; color: var(--muted); }
  .bar { position: relative; display: flex; height: 40px; border-radius: 12px; overflow: hidden; margin-top: 14px; background: rgba(255,255,255,.06); }
  .fill { position: relative; display: flex; align-items: center; font-weight: 700; font-size: 22px; transition: flex-grow .9s cubic-bezier(.25,1,.3,1); min-width: 0; overflow: hidden; white-space: nowrap; }
  .fill.a { background: linear-gradient(90deg, #8f0b14, var(--red)); justify-content: flex-start; padding-left: 14px; }
  .fill.b { background: linear-gradient(90deg, var(--blue), #164aa6); justify-content: flex-end; padding-right: 14px; }
  .fill::after { content: ""; position: absolute; inset: 0; background: linear-gradient(100deg, transparent 30%, rgba(255,255,255,.28) 50%, transparent 70%); transform: translateX(-100%); animation: shine 3.2s ease-in-out infinite; }
  .ratios { display: grid; grid-template-columns: 1fr auto 1fr; margin-top: 12px; align-items: end; }
  .ratio { font-size: 20px; color: var(--muted); }
  .ratio b { display: inline-block; font-size: 34px; color: #fff; margin-left: 6px; transition: transform .3s; }
  .ratios .rb { text-align: right; }
  .ratios .ra b { color: var(--red-hi); } .ratios .rb b { color: var(--blue-hi); }
  .total { text-align: center; font-size: 19px; color: var(--muted); }
  .foot { margin-top: 10px; font-size: 17px; color: rgba(255,255,255,.55); text-align: center; }
  .pop { position: absolute; font-weight: 700; font-size: 26px; pointer-events: none; animation: pop 1.4s ease-out forwards; text-shadow: 0 2px 8px rgba(0,0,0,.6); }
  .stamp { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%) rotate(-8deg) scale(2.2); opacity: 0; padding: 8px 26px; border: 4px solid #fff; border-radius: 14px; font-size: 40px; font-weight: 700; background: rgba(0,0,0,.55); letter-spacing: 1px; pointer-events: none; }
  .stamp.on { animation: stamp .5s cubic-bezier(.2,1.6,.4,1) forwards; }
  .lost { opacity: .38; filter: grayscale(.8); }
  .won .logo { box-shadow: 0 0 0 6px rgba(255,215,64,.35), 0 0 40px rgba(255,215,64,.8); animation: glow 1.2s ease-in-out infinite alternate; }
  .banner { margin-top: 14px; padding: 12px 18px; border-radius: 14px; background: linear-gradient(90deg, rgba(255,196,0,.22), rgba(255,196,0,.05)); border: 1px solid rgba(255,215,64,.5); font-size: 24px; font-weight: 700; display: none; }
  .banner.on { display: block; animation: rise .6s cubic-bezier(.2,1.3,.4,1); }
  .banner small { display: block; font-size: 18px; color: var(--muted); font-weight: 600; margin-top: 2px; }
  .overlay-logo { width: 1em; height: 1em; vertical-align: -0.15em; object-fit: contain; }
  .confetti { position: absolute; width: 10px; height: 16px; top: -20px; animation: fall linear forwards; border-radius: 2px; }
  @keyframes pulse { 50% { box-shadow: 0 0 0 8px rgba(217,18,31,.25); } }
  @keyframes blink { 50% { opacity: .2; } }
  @keyframes shine { 60%, 100% { transform: translateX(100%); } }
  @keyframes pop { from { opacity: 1; transform: translateY(0) scale(.8); } 20% { transform: translateY(-14px) scale(1.15); } to { opacity: 0; transform: translateY(-60px) scale(1); } }
  @keyframes stamp { to { opacity: 1; transform: translate(-50%,-50%) rotate(-8deg) scale(1); } }
  @keyframes glow { to { box-shadow: 0 0 0 10px rgba(255,215,64,.15), 0 0 60px rgba(255,215,64,1); } }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } }
  @keyframes fall { to { transform: translateY(420px) rotate(540deg); opacity: 0; } }
</style>
</head>
<body>
<div class="stage" id="stage">
  <div class="card" id="card">
    <div class="head">
      <span class="tag"> ทายผล</span>
      <span class="title" id="title"></span>
      <span class="state" id="state"></span>
    </div>
    <div class="row">
      <div class="side a" id="sideA"><div class="logo" id="logoA"></div><div style="min-width:0"><div class="name" id="nameA"></div><div class="meta" id="metaA"></div></div></div>
      <div class="vs">VS</div>
      <div class="side b" id="sideB"><div class="logo" id="logoB"></div><div style="min-width:0"><div class="name" id="nameB"></div><div class="meta" id="metaB"></div></div></div>
    </div>
    <div class="bar"><div class="fill a" id="fillA"></div><div class="fill b" id="fillB"></div></div>
    <div class="ratios">
      <div class="ratio ra">ผลตอบแทน<b id="ratioA">-</b></div>
      <div class="total" id="total"></div>
      <div class="ratio rb">ผลตอบแทน<b id="ratioB">-</b></div>
    </div>
    <div class="banner" id="banner"></div>
    <div class="foot" id="foot">เหรียญฟรี ไม่มีมูลค่าเป็นเงิน · ทายได้ที่เว็บ The Ranking และ Discord</div>
    <div class="stamp" id="stamp">🔒 ปิดรับคำทาย</div>
  </div>
</div>
<script>
(() => {
  const q = new URLSearchParams(location.search);
  const $ = (id) => document.getElementById(id);
  const stage = $("stage"), card = $("card");
  const scale = Math.min(Math.max(Number(q.get("scale")) || 1, 0.3), 2);
  stage.className = "stage " + (q.get("pos") === "top" ? "top" : "bottom");
  stage.style.transform = "translateX(-50%) scale(" + scale + ")";
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const shown = { a: 0, b: 0, pa: 0, pb: 0 };
  let last = null, locksAt = null, status = null;

  function tween(el, from, to, key, suffix) {
    const start = performance.now(), dur = 900;
    const step = (t) => {
      const k = Math.min((t - start) / dur, 1), e = 1 - Math.pow(1 - k, 3);
      el.textContent = fmt(from + (to - from) * e) + (suffix || "");
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    shown[key] = to;
  }
  function popUp(side, amount) {
    const el = document.createElement("div");
    el.className = "pop";
    el.textContent = "+" + fmt(amount);
    el.style.color = side === "a" ? "var(--red-hi)" : "var(--blue-hi)";
    el.style.top = "120px";
    el.style[side === "a" ? "left" : "right"] = (180 + Math.random() * 80) + "px";
    card.appendChild(el);
    setTimeout(() => el.remove(), 1500);
  }
  function confetti() {
    const colors = ["#ffd740", "#d9121f", "#2f7bff", "#ffffff"];
    for (let i = 0; i < 60; i++) {
      const c = document.createElement("div");
      c.className = "confetti";
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 1.6 + Math.random() * 1.6 + "s";
      c.style.animationDelay = Math.random() * 0.5 + "s";
      card.appendChild(c);
      setTimeout(() => c.remove(), 4000);
    }
  }
  function logo(el, o) {
    el.style.backgroundImage = o.logoUrl ? "url(" + JSON.stringify(o.logoUrl) + ")" : "";
    el.textContent = o.logoUrl ? "" : (o.name || "?").trim().slice(0, 1).toUpperCase();
  }
  const ratio = (r) => (r == null ? "-" : "x" + r.toFixed(r >= 10 ? 1 : 2));
  function clock() {
    if (status !== "open" || !locksAt) return;
    const s = Math.max(0, Math.floor((new Date(locksAt).getTime() - Date.now()) / 1000));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    $("state").textContent = "ทายได้อีก " + (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(ss).padStart(2, "0");
  }

  function render(data) {
    const m = data && data.market;
    if (!m || m.options.length < 2) { card.classList.remove("show"); last = null; return; }
    const [A, B] = m.options;
    const fresh = !last || last.id !== m.id;
    $("title").textContent = m.title + (data.tournament ? " · " + data.tournament : "");
    $("nameA").textContent = A.name; $("nameB").textContent = B.name;
    logo($("logoA"), A); logo($("logoB"), B);
    $("metaA").textContent = A.percent + "% · " + A.people + " คน";
    $("metaB").textContent = B.people + " คน · " + B.percent + "%";
    // An empty market shows an even split.
    const pa = m.pool ? A.coins / m.pool : 0.5, pb = 1 - pa;
    $("fillA").style.flexGrow = String(Math.max(pa, 0.04)); $("fillB").style.flexGrow = String(Math.max(pb, 0.04));
    if (!fresh && A.coins > shown.a) popUp("a", A.coins - shown.a);
    if (!fresh && B.coins > shown.b) popUp("b", B.coins - shown.b);
    tween($("fillA"), fresh ? 0 : shown.a, A.coins, "a", " เหรียญ");
    tween($("fillB"), fresh ? 0 : shown.b, B.coins, "b", " เหรียญ");
    $("ratioA").textContent = ratio(A.ratio); $("ratioB").textContent = ratio(B.ratio);
    $("total").textContent = "รวม " + fmt(m.pool) + " เหรียญ · " + m.people + " คน";

    const next = m.status === "SETTLED" ? "won" : m.status === "REFUNDED" ? "refund" : m.open ? "open" : "locked";
    const changed = next !== status || fresh;
    status = next; locksAt = m.locksAt;
    const st = $("state"), banner = $("banner"), stamp = $("stamp");
    st.className = "state" + (next === "open" ? " open" : "");
    $("sideA").className = "side a"; $("sideB").className = "side b";
    if (next === "open") { clock(); banner.className = "banner"; stamp.className = "stamp"; }
    if (next === "locked") { st.textContent = "🔒 ปิดรับคำทาย รอผล"; banner.className = "banner"; if (changed) { stamp.className = "stamp"; void stamp.offsetWidth; stamp.className = "stamp on"; setTimeout(() => (stamp.className = "stamp"), 2600); } }
    if (next === "refund") { st.textContent = "↩️ คืนเหรียญแล้ว"; stamp.className = "stamp"; banner.innerHTML = ""; banner.textContent = "คืนเหรียญทุกคน (ไม่มีการแข่ง หรือไม่มีใครทายถูก)"; banner.className = "banner on"; }
    if (next === "won") {
      const winA = m.winnerTeamId === A.id, w = winA ? A : B;
      $(winA ? "sideA" : "sideB").className = "side " + (winA ? "a" : "b") + " won";
      $(winA ? "sideB" : "sideA").className = "side " + (winA ? "b" : "a") + " lost";
      const logoMark = () => { const img = document.createElement("img"); img.src = "/images/logo.png"; img.alt = ""; img.className = "overlay-logo"; return img; };
      st.replaceChildren(logoMark(), " มีผลแล้ว"); stamp.className = "stamp";
      banner.replaceChildren(logoMark(), " " + w.name + " ชนะ! ทายถูก " + m.right + " คน ได้เหรียญ " + ratio(w.ratio));
      if (m.topWinners.length) {
        const s = document.createElement("small");
        s.textContent = "ได้มากสุด: " + m.topWinners.map((x) => x.name + " +" + fmt(x.won)).join(" · ");
        banner.appendChild(s);
      }
      if (changed) { banner.className = "banner"; void banner.offsetWidth; banner.className = "banner on"; confetti(); }
    }
    card.classList.add("show");
    last = m;
  }

  // ?preview=1: fake numbers so the overlay can be placed in vMix before a real match.
  let fake = null;
  function preview() {
    if (!fake) fake = { id: "preview", title: "คู่ที่ 1 · ตัวอย่าง", status: "OPEN", open: true, locksAt: new Date(Date.now() + 150000).toISOString(), winnerTeamId: null,
      options: [{ id: "A", name: "Team Alpha", logoUrl: null, coins: 100, people: 4 }, { id: "B", name: "Team Bravo", logoUrl: null, coins: 1000, people: 31 }], topWinners: [] };
    const age = (Date.now() - (preview.t0 || (preview.t0 = Date.now()))) / 1000 % 40;
    if (age < 20) { fake.options[Math.random() < 0.5 ? 0 : 1].coins += Math.floor(Math.random() * 120); fake.options.forEach((o) => (o.people += Math.random() < 0.3 ? 1 : 0)); fake.status = "OPEN"; fake.open = true; fake.winnerTeamId = null; }
    else if (age < 28) { fake.open = false; }
    else { fake.status = "SETTLED"; fake.winnerTeamId = "A"; fake.topWinners = [{ name: "Kite", won: 840 }, { name: "Moss", won: 310 }, { name: "Rook", won: 95 }]; }
    if (age < 2.5) { fake.options[0].coins = 100; fake.options[1].coins = 1000; }
    const pool = fake.options.reduce((n, o) => n + o.coins, 0);
    const options = fake.options.map((o) => ({ ...o, percent: Math.round((o.coins / pool) * 100), ratio: Math.floor((pool / o.coins) * 100) / 100 }));
    return { tournament: "The Ranking", market: { ...fake, options, pool, people: options.reduce((n, o) => n + o.people, 0), right: options[0].people } };
  }

  const url = "./predict/data?" + new URLSearchParams([...q].filter(([k]) => k === "t" || k === "m")).toString();
  async function tick() {
    try {
      render(q.get("preview") ? preview() : await (await fetch(url, { cache: "no-store" })).json());
    } catch { /* keep what is on screen; try again next tick */ }
    setTimeout(tick, 2500);
  }
  setInterval(clock, 1000);
  tick();
})();
</script>
</body>
</html>`;
