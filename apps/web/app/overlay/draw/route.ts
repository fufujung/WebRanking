export const dynamic = "force-dynamic";

/**
 * The lucky draw overlay for live streams (vMix / OBS browser input, 1920×1080, transparent).
 * While open: the word to type, how many joined and the time left, with new names popping in. When the
 * organizer draws: names spin and stop on each winner, with confetti. ?d=<draw> pins one draw (otherwise
 * the newest), ?pos=top puts it at the top, ?scale=0.8 resizes it, ?preview=1 plays a fake round.
 */
export function GET() {
  return new Response(HTML, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

const HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=1920, height=1080" />
<meta name="robots" content="noindex" />
<title>Lucky draw overlay</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai+Looped:wght@500;600;700&display=swap" rel="stylesheet" />
<style>
  :root { --red: #d9121f; --red-hi: #ff3b47; --gold: #ffd240; --ink: #fff; --muted: rgba(255,255,255,.72); --panel: rgba(12,12,16,.9); --line: rgba(255,255,255,.12); }
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: transparent; }
  body { font-family: "IBM Plex Sans Thai Looped", "Leelawadee UI", "Tahoma", sans-serif; color: var(--ink); }
  .stage { position: absolute; left: 50%; width: 1100px; transform-origin: center bottom; }
  .stage.bottom { bottom: 54px; }
  .stage.top { top: 54px; transform-origin: center top; }
  .card { position: relative; border-radius: 24px; background: var(--panel); border: 1px solid var(--line); box-shadow: 0 18px 50px rgba(0,0,0,.55); padding: 20px 28px 22px; overflow: hidden;
    opacity: 0; transform: translateY(40px) scale(.98); transition: opacity .5s ease, transform .6s cubic-bezier(.2,1.3,.4,1); }
  .card.show { opacity: 1; transform: none; }
  .card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 4px; background: linear-gradient(90deg, var(--red), var(--gold), var(--red)); background-size: 200% 100%; animation: slide 3s linear infinite; }
  .head { display: flex; align-items: center; gap: 14px; font-size: 22px; }
  .tag { font-weight: 700; letter-spacing: 1px; color: var(--gold); }
  .title { color: var(--muted); font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
  .state { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border-radius: 999px; font-weight: 700; font-size: 20px; background: rgba(255,255,255,.08); white-space: nowrap; }
  .state.open { background: var(--red); animation: pulse 1.6s ease-in-out infinite; }
  .state.open::before { content: ""; width: 10px; height: 10px; border-radius: 50%; background: #fff; animation: blink 1s steps(2) infinite; }
  .main { display: grid; grid-template-columns: 1fr auto; gap: 24px; align-items: center; margin-top: 14px; }
  .type { font-size: 28px; font-weight: 600; color: var(--muted); }
  .type b { display: inline-block; margin-left: 10px; padding: 2px 18px; border-radius: 14px; background: var(--red); color: #fff; font-size: 46px; letter-spacing: 1px; animation: bob 2.4s ease-in-out infinite; }
  .prize { margin-top: 6px; font-size: 22px; color: var(--gold); font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .count { text-align: right; }
  .count b { display: block; font-size: 64px; line-height: 1; transition: transform .25s; }
  .count b.bump { transform: scale(1.25); color: var(--gold); }
  .count span { font-size: 20px; color: var(--muted); }
  .ticker { position: relative; height: 40px; margin-top: 12px; overflow: hidden; }
  .chip { position: absolute; left: 0; top: 0; display: inline-flex; align-items: center; gap: 8px; padding: 4px 14px; border-radius: 999px; background: rgba(255,255,255,.08); font-size: 20px; white-space: nowrap; animation: chip 3.2s ease forwards; }
  .spin { display: none; margin-top: 16px; height: 120px; border-radius: 18px; background: rgba(255,255,255,.05); border: 2px solid var(--line); position: relative; overflow: hidden; }
  .spin.on { display: block; }
  .spin .name { position: absolute; inset: 0; display: grid; place-items: center; font-size: 56px; font-weight: 700; white-space: nowrap; }
  .spin.landed { border-color: var(--gold); box-shadow: 0 0 40px rgba(255,210,64,.6) inset; }
  .spin.landed .name { color: var(--gold); animation: land .6s cubic-bezier(.2,1.6,.4,1); }
  .winners { display: none; margin-top: 14px; gap: 10px; flex-wrap: wrap; }
  .winners.on { display: flex; }
  .w { display: inline-flex; align-items: center; gap: 10px; padding: 8px 16px; border-radius: 14px; background: linear-gradient(90deg, rgba(255,196,0,.22), rgba(255,196,0,.06)); border: 1px solid rgba(255,215,64,.5); font-size: 24px; font-weight: 700; animation: rise .6s cubic-bezier(.2,1.3,.4,1); }
  .w i { font-style: normal; color: var(--gold); }
  .w.void { opacity: .4; text-decoration: line-through; }
  .foot { margin-top: 10px; font-size: 17px; color: rgba(255,255,255,.55); text-align: center; }
  .confetti { position: absolute; width: 10px; height: 16px; top: -20px; animation: fall linear forwards; border-radius: 2px; }
  @keyframes slide { to { background-position: 200% 0; } }
  @keyframes pulse { 50% { box-shadow: 0 0 0 8px rgba(217,18,31,.25); } }
  @keyframes blink { 50% { opacity: .2; } }
  @keyframes bob { 50% { transform: translateY(-4px); } }
  @keyframes chip { from { opacity: 0; transform: translateY(30px); } 12% { opacity: 1; transform: none; } 80% { opacity: 1; } to { opacity: 0; transform: translateY(-30px); } }
  @keyframes land { from { transform: scale(1.6); } }
  @keyframes rise { from { opacity: 0; transform: translateY(16px); } }
  @keyframes fall { to { transform: translateY(520px) rotate(540deg); opacity: 0; } }
</style>
</head>
<body>
<div id="stage" class="stage bottom">
  <div id="card" class="card">
    <div class="head"><span class="tag">🎁 LUCKY DRAW</span><span id="title" class="title"></span><span id="state" class="state"></span></div>
    <div class="main">
      <div><div id="type" class="type">พิมพ์ในแชท<b id="kw"></b></div><div id="prize" class="prize"></div></div>
      <div class="count"><b id="count">0</b><span>คนเข้าร่วม</span></div>
    </div>
    <div id="ticker" class="ticker"></div>
    <div id="spin" class="spin"><div id="spinName" class="name"></div></div>
    <div id="winners" class="winners"></div>
    <div id="foot" class="foot"></div>
  </div>
</div>
<script>
(function () {
  var q = new URLSearchParams(location.search);
  var stage = document.getElementById("stage");
  if (q.get("pos") === "top") stage.className = "stage top";
  var scale = Math.min(Math.max(Number(q.get("scale")) || 1, 0.4), 2);
  stage.style.transform = "translateX(-50%) scale(" + scale + ")";
  var url = "/overlay/draw/data" + (q.get("d") ? "?d=" + encodeURIComponent(q.get("d")) : "");
  var $ = function (id) { return document.getElementById(id); };
  var draw = null, lastId = null, lastCount = -1, seenNames = {}, shown = {}, queue = [], spinning = false, first = true;

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function confetti() {
    var colors = ["#d9121f", "#ffd240", "#ffffff", "#ff3b47"];
    for (var i = 0; i < 70; i++) {
      var c = document.createElement("div");
      c.className = "confetti";
      c.style.left = Math.random() * 100 + "%";
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = 1.8 + Math.random() * 1.8 + "s";
      c.style.animationDelay = Math.random() * 0.5 + "s";
      $("card").appendChild(c);
      setTimeout(function (el) { el.remove(); }, 4500, c);
    }
  }
  function clock() {
    if (!draw || draw.status !== "OPEN" || !draw.closesAt) return;
    var left = Math.max(0, Math.floor((new Date(draw.closesAt).getTime() - Date.now()) / 1000));
    $("state").textContent = "เปิดรับ " + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0");
  }
  function winnersList() {
    $("winners").innerHTML = (draw.winnerList || []).filter(function (w) { return shown[w.place]; }).map(function (w) {
      return '<span class="w' + (w.voided ? " void" : "") + '"><i>#' + w.place + "</i>" + esc(w.name) + "</span>";
    }).join("");
    $("winners").className = "winners" + ($("winners").innerHTML ? " on" : "");
  }
  // Names spin faster, then slower, then stop on the winner.
  function spinNext() {
    if (spinning || !queue.length) return;
    spinning = true;
    var w = queue.shift(), pool = (draw.names && draw.names.length ? draw.names : [w.name]).slice(), t = 0, delay = 50;
    $("spin").className = "spin on";
    function step() {
      $("spinName").textContent = pool[Math.floor(Math.random() * pool.length)];
      t += delay;
      if (t < 3600) { delay = Math.min(delay * 1.07, 380); setTimeout(step, delay); return; }
      $("spinName").textContent = "🎉 " + w.name;
      $("spin").className = "spin on landed";
      confetti();
      shown[w.place] = true;
      winnersList();
      setTimeout(function () { spinning = false; if (queue.length) spinNext(); }, 2600);
    }
    step();
  }
  function render(data) {
    var d = data && data.draw;
    if (!d || d.status === "DRAFT") { $("card").className = "card"; return; }
    if (d.id !== lastId) { lastId = d.id; lastCount = -1; seenNames = {}; shown = {}; queue = []; first = true; $("spin").className = "spin"; }
    draw = d;
    $("card").className = "card show";
    $("title").textContent = d.title;
    $("kw").textContent = d.keyword;
    $("prize").textContent = d.prize ? "รางวัล: " + d.prize : "";
    $("type").style.display = d.status === "OPEN" ? "" : "none";
    if (d.status === "OPEN") { $("state").className = "state open"; $("state").textContent = "เปิดรับ"; clock(); }
    else { $("state").className = "state"; $("state").textContent = (d.winnerList || []).length ? "ประกาศผล" : "ปิดรับแล้ว · รอสุ่ม"; }
    if (d.count !== lastCount) {
      $("count").textContent = d.count;
      if (lastCount >= 0) { $("count").classList.add("bump"); setTimeout(function () { $("count").classList.remove("bump"); }, 250); }
      lastCount = d.count;
    }
    // New names pop in one after another (not on the first load).
    (d.latest || []).slice().reverse().forEach(function (e, i) {
      var key = e.source + ":" + e.name;
      if (seenNames[key]) return;
      seenNames[key] = true;
      if (first || d.status !== "OPEN") return;
      setTimeout(function () {
        var c = document.createElement("span");
        c.className = "chip";
        c.textContent = (e.source === "YOUTUBE" ? "▶ " : e.source === "DISCORD" ? "💬 " : "✍ ") + e.name + " เข้าร่วมแล้ว";
        $("ticker").appendChild(c);
        setTimeout(function () { c.remove(); }, 3300);
      }, i * 700);
    });
    var fresh = (d.winnerList || []).filter(function (w) { return !shown[w.place] && !queue.some(function (x) { return x.place === w.place; }); });
    if (first) fresh.forEach(function (w) { shown[w.place] = true; });
    else queue = queue.concat(fresh.sort(function (a, b) { return a.place - b.place; }));
    if (!spinning) { winnersList(); spinNext(); }
    var bonus = [d.memberWeight > 1 ? "⭐ Member x" + d.memberWeight : "", d.linkedWeight > 1 ? "🔗 ผูก Discord กับเว็บ x" + d.linkedWeight : ""].filter(Boolean).join(" · ");
    $("foot").textContent = d.status === "OPEN" ? (d.allowDiscord ? "หรือกดปุ่ม 🎁 เข้าร่วม ใน Discord · " : "") + (bonus ? "โอกาสพิเศษ " + bonus : "คนละ 1 สิทธิ์") + " · ร่วมฟรี" : "";
    first = false;
  }

  // ?preview=1: a fake round so the overlay can be placed in vMix before a real one.
  var fake = null, t0 = Date.now();
  var NAMES = ["Kuroko", "Kagami", "Aomine", "Kise", "Midorima", "Murasakibara", "Akashi", "Momoi", "Hyuga", "Riko", "Izuki", "Takao"];
  function preview() {
    var age = (Date.now() - t0) / 1000 % 40, n = Math.min(NAMES.length, Math.floor(age / 1.5));
    fake = { id: "preview", title: "ตัวอย่าง Lucky Draw", keyword: "#OT500", prize: "คีย์บอร์ดเกมมิ่ง", winners: 1, status: age < 20 ? "OPEN" : "CLOSED", allowDiscord: true,
      closesAt: new Date(t0 + Math.floor((Date.now() - t0) / 40000) * 40000 + 20000).toISOString(), count: n * 7, names: NAMES,
      latest: NAMES.slice(0, n).reverse().map(function (x) { return { name: x, source: "YOUTUBE" }; }), winnerList: age > 24 ? [{ name: "Aomine", place: 1, source: "YOUTUBE", voided: false }] : [] };
    if (age < 1) lastId = null;
    return { draw: fake };
  }
  async function tick() {
    try { render(q.get("preview") ? preview() : await (await fetch(url, { cache: "no-store" })).json()); } catch (e) { /* keep the last frame */ }
  }
  tick();
  setInterval(tick, 2000);
  setInterval(clock, 1000);
})();
</script>
</body>
</html>`;
