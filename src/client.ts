// ボード画面の HTML。外側が TS のテンプレートリテラルなので、
// 中の JS ではバッククォートと "${" を使わないこと。
export const boardHtml = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TeamCanvas</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css">
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.js"></script>
<script defer src="https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/contrib/auto-render.min.js" onload="katexLoaded()"></script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #e5e7eb;
    display: flex;
    flex-direction: column;
    touch-action: none;
  }
  #toolbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    background: #1f2937;
    color: #f9fafb;
    flex: none;
    flex-wrap: wrap;
  }
  #toolbar .brand { font-weight: 700; margin-right: 6px; }
  .swatch {
    width: 24px; height: 24px;
    border-radius: 50%;
    border: 2px solid transparent;
    cursor: pointer;
    padding: 0;
  }
  .swatch.active { border-color: #fff; box-shadow: 0 0 0 2px #6b7280; }
  .tool {
    background: #374151;
    color: #f9fafb;
    border: none;
    border-radius: 6px;
    padding: 5px 10px;
    font-size: 15px;
    cursor: pointer;
  }
  .tool.active { background: #2563eb; }
  #size { width: 90px; }
  #users { display: flex; gap: 4px; margin-left: auto; align-items: center; }
  .userdot {
    width: 22px; height: 22px;
    border-radius: 50%;
    color: #fff;
    font-size: 11px;
    display: flex; align-items: center; justify-content: center;
    border: 2px solid #1f2937;
  }
  #status { font-size: 12px; color: #9ca3af; }
  #stage { position: relative; flex: 1; min-height: 0; }
  #stage canvas { position: absolute; inset: 0; }
  #top { cursor: crosshair; }
  #pagebar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: #1f2937;
    flex: none;
    overflow-x: auto;
  }
  .tab {
    min-width: 36px;
    padding: 4px 10px;
    border: none;
    border-radius: 6px;
    background: #374151;
    color: #d1d5db;
    cursor: pointer;
    font-size: 13px;
  }
  .tab.active { background: #2563eb; color: #fff; }
  #texlayer {
    position: absolute;
    left: 0; top: 0;
    width: 1600px; height: 1000px;
    transform-origin: 0 0;
    pointer-events: none;
    overflow: hidden;
  }
  .textitem {
    position: absolute;
    white-space: pre-wrap;
    max-width: 900px;
    line-height: 1.45;
  }
  #editor {
    position: absolute;
    display: none;
    z-index: 10;
    border: 2px solid #2563eb;
    border-radius: 4px;
    padding: 4px 6px;
    background: #fff;
    font-family: inherit;
    line-height: 1.45;
    resize: both;
    min-width: 200px;
    min-height: 44px;
  }
</style>
</head>
<body>
<div id="toolbar">
  <span class="brand">TeamCanvas</span>
  <span id="colors"></span>
  <input id="size" type="range" min="2" max="24" value="4" title="太さ">
  <button id="pen" class="tool active" title="ペン">&#9998; ペン</button>
  <button id="eraser" class="tool" title="消しゴム">&#9723; 消しゴム</button>
  <button id="text" class="tool" title="テキスト($...$ でTeX数式)">T テキスト</button>
  <button id="share" class="tool" title="URLをコピー">URLをコピー</button>
  <span id="status"></span>
  <span id="users"></span>
</div>
<div id="stage">
  <canvas id="base"></canvas>
  <div id="texlayer"></div>
  <canvas id="top"></canvas>
  <textarea id="editor" placeholder="テキスト($...$ でTeX数式)&#10;Ctrl+Enterで確定 / Escで取消"></textarea>
</div>
<div id="pagebar">
  <span id="tabs" style="display:flex;gap:6px;"></span>
  <button id="addpage" class="tab" title="ページを追加">＋</button>
</div>
<script>
"use strict";
var W = 1600, H = 1000;
var PEN_COLORS = ["#111827", "#dc2626", "#2563eb", "#16a34a", "#d97706", "#9333ea"];

var pages = [];
var cur = null;
var strokes = [];        // 表示中ページの確定ストローク
var live = {};           // 描画中のリモートストローク id -> stroke
var cursors = {};        // userId -> {x,y,pageId,name,color,t}
var users = {};          // userId -> user
var me = null;
var ws = null;
var connected = false;

var tool = "pen";
var penColor = PEN_COLORS[0];
var penSize = 4;
var drawing = null;      // 自分の描画中ストローク
var pendingPts = [];     // 未送信の点
var eraseIds = [];       // 未送信の消去ID
var lastCursor = 0;
var lastPt = null;       // 最後のポインタ位置(仮想座標)
var editing = null;      // テキスト編集中の配置位置 {x, y}
var itemEls = {};        // テキストアイテム id -> DOM要素
var ERASE_R = 14;        // 消しゴム半径(仮想座標)

var baseC = document.getElementById("base");
var topC = document.getElementById("top");
var stage = document.getElementById("stage");
var texLayer = document.getElementById("texlayer");
var editor = document.getElementById("editor");
var view = { scale: 1, ox: 0, oy: 0, dpr: 1 };

function newId() {
  return Math.random().toString(36).slice(2, 10);
}

/* ---------- レイアウト・描画 ---------- */
function layout() {
  var r = stage.getBoundingClientRect();
  var dpr = window.devicePixelRatio || 1;
  [baseC, topC].forEach(function (c) {
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    c.style.width = r.width + "px";
    c.style.height = r.height + "px";
  });
  var scale = Math.min(r.width / W, r.height / H) * 0.97;
  view = {
    scale: scale,
    ox: (r.width - W * scale) / 2,
    oy: (r.height - H * scale) / 2,
    dpr: dpr
  };
  texLayer.style.transform = "translate(" + view.ox + "px," + view.oy + "px) scale(" + view.scale + ")";
  redrawBase();
}

function setT(ctx) {
  ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale,
    view.dpr * view.ox, view.dpr * view.oy);
}

function clear(ctx, c) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
}

function drawStroke(ctx, s) {
  if (!s.pts || s.pts.length === 0) return;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(s.pts[0][0], s.pts[0][1]);
  if (s.pts.length === 1) {
    ctx.lineTo(s.pts[0][0] + 0.01, s.pts[0][1]);
  }
  for (var i = 1; i < s.pts.length; i++) {
    ctx.lineTo(s.pts[i][0], s.pts[i][1]);
  }
  ctx.stroke();
}

function redrawBase() {
  var ctx = baseC.getContext("2d");
  clear(ctx, baseC);
  setT(ctx);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#d1d5db";
  ctx.lineWidth = 1 / view.scale;
  ctx.strokeRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  for (var i = 0; i < strokes.length; i++) drawStroke(ctx, strokes[i]);
  ctx.restore();
}

function drawTop() {
  var ctx = topC.getContext("2d");
  clear(ctx, topC);
  setT(ctx);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  for (var id in live) {
    if (live[id].pageId === cur) drawStroke(ctx, live[id]);
  }
  if (drawing) drawStroke(ctx, drawing);
  ctx.restore();
  if (tool === "eraser" && lastPt) {
    ctx.strokeStyle = "#6b7280";
    ctx.lineWidth = 1.5 / view.scale;
    ctx.beginPath();
    ctx.arc(lastPt[0], lastPt[1], ERASE_R, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 他ユーザーのマーカー
  var now = Date.now();
  for (var uid in cursors) {
    var cu = cursors[uid];
    if (cu.pageId !== cur || now - cu.t > 6000) continue;
    ctx.fillStyle = cu.color;
    ctx.beginPath();
    ctx.arc(cu.x, cu.y, 7 / view.scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = (13 / view.scale) + "px system-ui";
    var tw = ctx.measureText(cu.name).width;
    ctx.fillStyle = "rgba(31,41,55,0.85)";
    ctx.fillRect(cu.x + 10 / view.scale, cu.y - 9 / view.scale,
      tw + 10 / view.scale, 19 / view.scale);
    ctx.fillStyle = "#fff";
    ctx.fillText(cu.name, cu.x + 15 / view.scale, cu.y + 5 / view.scale);
  }
  requestAnimationFrame(drawTop);
}

/* ---------- 通信 ---------- */
function send(msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function connect() {
  var proto = location.protocol === "https:" ? "wss://" : "ws://";
  ws = new WebSocket(proto + location.host + location.pathname + "/ws");
  ws.onopen = function () {
    connected = true;
    setStatus("");
  };
  ws.onclose = function () {
    connected = false;
    setStatus("再接続中…");
    setTimeout(connect, 1500);
  };
  ws.onmessage = function (ev) {
    var m;
    try { m = JSON.parse(ev.data); } catch (e) { return; }
    handle(m);
  };
}

function handle(m) {
  switch (m.type) {
    case "init":
      me = m.user;
      pages = m.pages;
      users = {};
      m.users.forEach(function (u) { users[u.id] = u; });
      if (!cur || pages.indexOf(cur) < 0) cur = pages[0];
      strokes = [];
      send({ type: "load", pageId: cur });
      renderTabs();
      renderUsers();
      redrawBase();
      break;
    case "pageData":
      if (m.pageId === cur) {
        strokes = m.strokes;
        redrawBase();
        renderItems();
      }
      break;
    case "pages":
      pages = m.pages;
      renderTabs();
      break;
    case "stroke:start":
      live[m.stroke.id] = {
        id: m.stroke.id, color: m.stroke.color, size: m.stroke.size,
        pageId: m.pageId, pts: [m.pt]
      };
      break;
    case "stroke:points":
      if (live[m.id]) live[m.id].pts = live[m.id].pts.concat(m.pts);
      break;
    case "stroke:end":
      delete live[m.stroke.id];
      if (m.pageId === cur) {
        strokes.push(m.stroke);
        redrawBase();
        renderItems();
      }
      break;
    case "erase":
      if (m.pageId === cur) {
        strokes = strokes.filter(function (s) { return m.ids.indexOf(s.id) < 0; });
        redrawBase();
        renderItems();
      }
      break;
    case "cursor":
      cursors[m.id] = { x: m.x, y: m.y, pageId: m.pageId, name: m.name, color: m.color, t: Date.now() };
      break;
    case "join":
      users[m.user.id] = m.user;
      renderUsers();
      break;
    case "leave":
      delete users[m.id];
      delete cursors[m.id];
      renderUsers();
      break;
  }
}

/* ---------- 入力 ---------- */
function toVirtual(e) {
  var r = topC.getBoundingClientRect();
  var x = (e.clientX - r.left - view.ox) / view.scale;
  var y = (e.clientY - r.top - view.oy) / view.scale;
  return [Math.round(x * 10) / 10, Math.round(y * 10) / 10];
}

function distToSeg(p, a, b) {
  var dx = b[0] - a[0], dy = b[1] - a[1];
  var len2 = dx * dx + dy * dy;
  var t = len2 === 0 ? 0 :
    Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  var px = a[0] + t * dx - p[0], py = a[1] + t * dy - p[1];
  return Math.sqrt(px * px + py * py);
}

// 消しゴム円の近くのセグメントを細分化したうえで、円内の点を除いた
// 連続区間(断片)に分割する。1点も消えなければ null(変更なし)。
function splitStroke(s, pt) {
  var r = ERASE_R + s.size / 2;
  var pts = [];
  for (var i = 0; i < s.pts.length; i++) {
    pts.push(s.pts[i]);
    if (i + 1 < s.pts.length && distToSeg(pt, s.pts[i], s.pts[i + 1]) < r) {
      var a = s.pts[i], b = s.pts[i + 1];
      var dx = b[0] - a[0], dy = b[1] - a[1];
      var n = Math.floor(Math.sqrt(dx * dx + dy * dy) / (r / 3));
      for (var k = 1; k <= n; k++) {
        pts.push([
          Math.round((a[0] + dx * k / (n + 1)) * 10) / 10,
          Math.round((a[1] + dy * k / (n + 1)) * 10) / 10
        ]);
      }
    }
  }
  var runs = [], run = [], erased = 0;
  for (var j = 0; j < pts.length; j++) {
    var ex = pts[j][0] - pt[0], ey = pts[j][1] - pt[1];
    if (ex * ex + ey * ey < r * r) {
      erased++;
      if (run.length > 1) runs.push(run);
      run = [];
    } else {
      run.push(pts[j]);
    }
  }
  if (erased === 0) return null;
  if (run.length > 1) runs.push(run);
  return runs;
}

function textHit(s, pt) {
  var el = itemEls[s.id];
  var w = el ? el.offsetWidth : 100;
  var h = el ? el.offsetHeight : s.size * 1.5;
  return pt[0] >= s.x - ERASE_R && pt[0] <= s.x + w + ERASE_R &&
    pt[1] >= s.y - ERASE_R && pt[1] <= s.y + h + ERASE_R;
}

function eraseAt(pt) {
  var changed = false;
  var kept = [];
  for (var i = 0; i < strokes.length; i++) {
    var s = strokes[i];
    if (s.kind === "text") {
      // テキスト・数式は部分消去せず、触れたら丸ごと消す
      if (textHit(s, pt)) {
        eraseIds.push(s.id);
        changed = true;
      } else {
        kept.push(s);
      }
      continue;
    }
    var hit = false;
    for (var j = 0; j < s.pts.length; j++) {
      var a = s.pts[j], b = s.pts[Math.min(j + 1, s.pts.length - 1)];
      if (distToSeg(pt, a, b) < ERASE_R + s.size / 2) { hit = true; break; }
    }
    if (!hit) { kept.push(s); continue; }
    var runs = splitStroke(s, pt);
    if (runs === null) { kept.push(s); continue; }
    changed = true;
    eraseIds.push(s.id);
    for (var k = 0; k < runs.length; k++) {
      var frag = { id: newId(), color: s.color, size: s.size, pts: runs[k], t: s.t };
      kept.push(frag);
      send({ type: "stroke:end", pageId: cur, stroke: frag });
    }
  }
  if (changed) {
    strokes = kept;
    redrawBase();
    renderItems();
  }
}

topC.addEventListener("pointerdown", function (e) {
  if (!connected || !cur) return;
  if (editing) commitEditor();
  var pt = toVirtual(e);
  if (tool === "text") {
    e.preventDefault();
    openEditor(pt);
    return;
  }
  topC.setPointerCapture(e.pointerId);
  if (tool === "pen") {
    drawing = { id: newId(), color: penColor, size: penSize, pts: [pt], t: Date.now() };
    send({ type: "stroke:start", pageId: cur,
      stroke: { id: drawing.id, color: penColor, size: penSize }, pt: pt });
  } else if (tool === "eraser") {
    eraseAt(pt);
  }
});

topC.addEventListener("pointermove", function (e) {
  var pt = toVirtual(e);
  lastPt = pt;
  var now = Date.now();
  if (now - lastCursor > 80 && connected && cur) {
    lastCursor = now;
    send({ type: "cursor", pageId: cur, x: pt[0], y: pt[1] });
  }
  if (e.buttons === 0) return;
  if (tool === "pen" && drawing) {
    drawing.pts.push(pt);
    pendingPts.push(pt);
  } else if (tool === "eraser") {
    eraseAt(pt);
  }
});

function finishStroke() {
  if (!drawing) return;
  flushPending();
  strokes.push(drawing);
  send({ type: "stroke:end", pageId: cur, stroke: drawing });
  drawing = null;
  redrawBase();
}

topC.addEventListener("pointerup", finishStroke);
topC.addEventListener("pointercancel", function () { drawing = null; });
topC.addEventListener("pointerleave", function () { lastPt = null; });

/* ---------- テキスト・TeX数式 ---------- */
function textSize() {
  return Math.max(14, penSize * 3);
}

function mathify(el) {
  if (el.dataset.math === "1" || !window.renderMathInElement) return;
  try {
    renderMathInElement(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false }
      ],
      throwOnError: false
    });
    el.dataset.math = "1";
  } catch (err) { /* KaTeX 失敗時はプレーンテキストのまま */ }
}

function katexLoaded() {
  for (var id in itemEls) mathify(itemEls[id]);
}

function renderItems() {
  var wanted = {};
  for (var i = 0; i < strokes.length; i++) {
    var s = strokes[i];
    if (s.kind !== "text") continue;
    wanted[s.id] = true;
    if (!itemEls[s.id]) {
      var el = document.createElement("div");
      el.className = "textitem";
      el.style.left = s.x + "px";
      el.style.top = s.y + "px";
      el.style.color = s.color;
      el.style.fontSize = s.size + "px";
      el.textContent = s.text;
      texLayer.appendChild(el);
      itemEls[s.id] = el;
      mathify(el);
    }
  }
  for (var id in itemEls) {
    if (!wanted[id]) {
      itemEls[id].remove();
      delete itemEls[id];
    }
  }
}

function addTextItem(pt, text) {
  var item = {
    id: newId(), kind: "text", x: pt[0], y: pt[1],
    text: text, color: penColor, size: textSize(), t: Date.now()
  };
  strokes.push(item);
  renderItems();
  send({ type: "stroke:end", pageId: cur, stroke: item });
}

function openEditor(pt) {
  editing = { x: pt[0], y: pt[1] };
  editor.style.left = (view.ox + pt[0] * view.scale) + "px";
  editor.style.top = (view.oy + pt[1] * view.scale) + "px";
  editor.style.fontSize = (textSize() * view.scale) + "px";
  editor.style.color = penColor;
  editor.value = "";
  editor.style.display = "block";
  setTimeout(function () { editor.focus(); }, 0);
}

function commitEditor() {
  if (!editing) return;
  var pos = editing;
  var text = editor.value.trimEnd();
  editing = null;
  editor.style.display = "none";
  if (text.length > 0) addTextItem([pos.x, pos.y], text);
}

editor.addEventListener("blur", commitEditor);
editor.addEventListener("keydown", function (e) {
  e.stopPropagation();
  if (e.key === "Escape") {
    editing = null;
    editor.style.display = "none";
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    commitEditor();
  }
});

// エディタ外での貼り付けはテキストアイテムとして配置
document.addEventListener("paste", function (e) {
  if (editing || !connected || !cur) return;
  var text = e.clipboardData ? e.clipboardData.getData("text/plain") : "";
  if (!text || !text.trim()) return;
  e.preventDefault();
  addTextItem(lastPt || [W / 2 - 200, H / 2 - 50], text.trimEnd());
});

// 点と消去IDをまとめて送る(メッセージ数の節約)
setInterval(flushPending, 40);
function flushPending() {
  if (drawing && pendingPts.length > 0) {
    send({ type: "stroke:points", pageId: cur, id: drawing.id, pts: pendingPts });
    pendingPts = [];
  }
  if (eraseIds.length > 0) {
    send({ type: "erase", pageId: cur, ids: eraseIds.slice(0, 128) });
    eraseIds = eraseIds.slice(128);
  }
}

/* ---------- UI ---------- */
function setStatus(s) {
  document.getElementById("status").textContent = s;
}

function renderTabs() {
  var el = document.getElementById("tabs");
  el.innerHTML = "";
  pages.forEach(function (id, i) {
    var b = document.createElement("button");
    b.className = "tab" + (id === cur ? " active" : "");
    b.textContent = String(i + 1);
    b.onclick = function () { switchPage(id); };
    el.appendChild(b);
  });
}

function switchPage(id) {
  if (id === cur) return;
  finishStroke();
  if (editing) commitEditor();
  cur = id;
  strokes = [];
  redrawBase();
  renderItems();
  renderTabs();
  send({ type: "load", pageId: cur });
}

function renderUsers() {
  var el = document.getElementById("users");
  el.innerHTML = "";
  Object.keys(users).forEach(function (id) {
    var u = users[id];
    var d = document.createElement("span");
    d.className = "userdot";
    d.style.background = u.color;
    d.title = u.name + (me && id === me.id ? "(自分)" : "");
    d.textContent = u.name.replace("ゲスト", "");
    el.appendChild(d);
  });
}

var colorsEl = document.getElementById("colors");
PEN_COLORS.forEach(function (c, i) {
  var b = document.createElement("button");
  b.className = "swatch" + (i === 0 ? " active" : "");
  b.style.background = c;
  b.onclick = function () {
    penColor = c;
    tool = "pen";
    updateToolButtons();
    document.querySelectorAll(".swatch").forEach(function (s) {
      s.classList.toggle("active", s === b);
    });
  };
  colorsEl.appendChild(b);
});

function updateToolButtons() {
  document.getElementById("pen").classList.toggle("active", tool === "pen");
  document.getElementById("eraser").classList.toggle("active", tool === "eraser");
  document.getElementById("text").classList.toggle("active", tool === "text");
  topC.style.cursor = tool === "text" ? "text" : (tool === "eraser" ? "none" : "crosshair");
}
document.getElementById("pen").onclick = function () { tool = "pen"; updateToolButtons(); };
document.getElementById("eraser").onclick = function () { tool = "eraser"; updateToolButtons(); };
document.getElementById("text").onclick = function () { tool = "text"; updateToolButtons(); };
document.getElementById("size").oninput = function (e) { penSize = Number(e.target.value); };
document.getElementById("addpage").onclick = function () { send({ type: "page:add" }); };
document.getElementById("share").onclick = function () {
  navigator.clipboard.writeText(location.href).then(function () {
    setStatus("URLをコピーしました");
    setTimeout(function () { setStatus(""); }, 2000);
  });
};

window.addEventListener("resize", layout);
layout();
requestAnimationFrame(drawTop);
connect();
</script>
</body>
</html>`;
