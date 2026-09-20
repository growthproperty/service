const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const man = (n) => (n / 10000).toLocaleString("ja-JP", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nearest = (r) => (r.stations || []).reduce((a, b) => {
  const w = (s) => { const m = /徒歩(\d+)分/.exec(s); return m ? +m[1] : 99; };
  return w(b) < w(a) ? b : a;
}, r.stations?.[0] || "");
const layoutGroup = (l) => (parseInt(l) >= 3 ? "3" : parseInt(l) >= 2 ? "2" : "1");

let DATA = null;

// Studioなどに埋め込むとき（?embed=1）は、外側のサイトと重なるヘッダー等を隠して高さを親に伝える
const EMBED = new URLSearchParams(location.search).get("embed") === "1";
function setupEmbed() {
  if (!EMBED) return;
  document.documentElement.classList.add("embed");
  const post = () => parent.postMessage({ type: "gp-height", height: document.body.scrollHeight }, "*");
  new ResizeObserver(post).observe(document.body);
  addEventListener("load", post);
}
const keepEmbed = (url) => (EMBED ? url + "&embed=1" : url);

async function loadData() {
  if (DATA) return DATA;
  let lastErr;
  for (let i = 0; i < 3; i++) {                       // 通信が切れることがあるので数回まで再試行
    try {
      const res = await fetch("data/rooms.json", { cache: "no-store" });
      if (!res.ok) throw new Error(res.status);
      DATA = await res.json();
      return DATA;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---------- 一覧 ---------- */
async function initList() {
  setupEmbed();
  const d = await loadData();
  const $ = (id) => document.getElementById(id);
  const rooms = d.rooms;

  const cities = [...new Set(rooms.map((r) => r.city))].sort();
  $("f-city").innerHTML += cities.map((c) => `<option>${esc(c)}</option>`).join("");
  $("updated").textContent = d.updated.replaceAll("-", "/");
  $("next-update").textContent = d.next_update.replaceAll("-", "/");

  let sortKey = "seq", sortAsc = true;   // 既定は新着順（イタンジの並び順）

  const render = () => {
    const city = $("f-city").value, rent = +$("f-rent").value,
      layout = $("f-layout").value, walk = +$("f-walk").value, area = +$("f-area").value;
    let list = rooms.filter((r) =>
      (!city || r.city === city) &&
      (!rent || r.rent <= rent) &&
      (!layout || layoutGroup(r.layout) === layout) &&
      (!walk || (r.walk ?? 99) <= walk) &&
      (!area || r.area >= area)
    );
    list = sortGrouped(list, sortKey, sortAsc);
    $("count").textContent = list.length;
    $("rows").innerHTML = list.length
      ? list.map(row).join("")
      : `<tr><td colspan="8" class="empty">条件に合うお部屋が見つかりませんでした。条件を変えてお試しください。</td></tr>`;
    document.querySelectorAll("th[data-key]").forEach((th) => {
      th.classList.toggle("sorted", th.dataset.key === sortKey);
      th.dataset.dir = th.dataset.key === sortKey ? (sortAsc ? "asc" : "desc") : "";
    });
  };

  document.querySelectorAll(".filters select").forEach((el) => el.addEventListener("change", render));
  document.querySelectorAll("th[data-key]").forEach((th) =>
    th.addEventListener("click", () => {
      if (sortKey === th.dataset.key) sortAsc = !sortAsc;
      else { sortKey = th.dataset.key; sortAsc = true; }
      render();
    })
  );
  $("f-reset").addEventListener("click", () => {
    document.querySelectorAll(".filters select").forEach((s) => (s.value = ""));
    sortKey = "seq"; sortAsc = true;
    render();
  });
  render();
}

// 同じ建物のお部屋は必ず隣同士に並べる。建物の順番は、その建物で一番上に来るお部屋で決める
function sortGrouped(list, key, asc) {
  const val = {
    seq: (r) => r.seq,
    rent: (r) => r.rent,
    area: (r) => r.area,
    walk: (r) => r.walk ?? 99,
    building: (r) => r.building,
  }[key];
  const cmp = (x, y) => (typeof x === "string" ? x.localeCompare(y, "ja") : x - y) * (asc ? 1 : -1);

  const groups = new Map();
  for (const r of list) {
    const key = r.building + "|" + r.address;   // 同名・同住所は同じ建物とみなす
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()]
    .map((rooms) => {
      rooms.sort((a, b) => cmp(val(a), val(b)) || a.seq - b.seq);
      return rooms;
    })
    .sort((a, b) => cmp(val(a[0]), val(b[0])) || a[0].seq - b[0].seq)
    .flat();
}

function row(r) {
  const st = nearest(r);
  return `<tr onclick="location.href='${keepEmbed(`property.html?id=${encodeURIComponent(r.id)}`)}'">
    <td data-l="物件名"><span><b>${esc(r.building)}</b> <span class="room">${esc(r.room)}</span></span></td>
    <td data-l="所在地">${esc(r.city)}</td>
    <td data-l="最寄駅" class="sub">${esc(st)}</td>
    <td data-l="間取り">${esc(r.layout)}</td>
    <td data-l="専有面積">${r.area}㎡</td>
    <td data-l="賃料" class="rent"><span>${man(r.rent)}<small>万円</small></span></td>
    <td data-l="敷金 / 礼金" class="sub">${esc(r.deposit)} / ${esc(r.key_money)}</td>
    <td data-l="入居可能" class="sub">${esc(r.move_in)}</td>
  </tr>`;
}

/* ---------- 詳細 ---------- */
async function initDetail() {
  setupEmbed();
  const d = await loadData();
  const id = new URLSearchParams(location.search).get("id");
  const r = d.rooms.find((x) => x.id === id);
  const root = document.getElementById("detail-root");
  if (!r) {
    root.innerHTML = `<p class="empty">このお部屋は掲載を終了しました。<br><a href="${keepEmbed("./?x=1")}" style="color:var(--blue)">物件一覧へ戻る</a></p>`;
    return;
  }
  document.title = `${r.building} ${r.room}｜物件情報｜株式会社グロースプロパティ`;
  document.getElementById("crumb-name").textContent = `${r.building} ${r.room}`;

  const rows = [
    ["賃料", `${r.rent.toLocaleString()}円<span class="note-inline">（見守りサービス料を含む）</span>`, "管理費・共益費", `${r.admin_fee.toLocaleString()}円`],
    ["敷金", esc(r.deposit), "礼金", esc(r.key_money)],
    ["間取り", esc(r.layout), "専有面積", `${r.area}㎡`],
    ["所在地", esc(r.address), "交通", (r.stations || []).map(esc).join("<br>")],
    ["築年月", `${esc(r.built)}（築${r.age}年）`, "建物", esc(r.story)],
    ["入居可能時期", esc(r.move_in), "部屋番号", esc(r.room)],
    ["取引態様", "転貸人（貸主）", "物件番号", esc(r.id)],
  ];

  root.innerHTML = `
    <p class="back-link"><a href="${keepEmbed("./?x=1")}">← 物件一覧へ戻る</a></p>
    <div class="detail">
      <div class="summary">
        <div class="status-line">物件番号 ${esc(r.id)}</div>
        <h1>${esc(r.building)} ${esc(r.room)}</h1>
        <div class="addr">${esc(r.address)}</div>
        <div class="rent">${man(r.rent)}<small>万円 / 管理費 ${r.admin_fee.toLocaleString()}円</small></div>
        <div class="quick">
          <div>間取り<b>${esc(r.layout)}</b></div>
          <div>面積<b>${r.area}㎡</b></div>
          <div>駅徒歩<b>${r.walk ?? "-"}分</b></div>
        </div>
        <div class="tags">
          <span class="tag">見守りサービス付</span>
          <span class="tag">法人契約（転貸）</span>
          <span class="tag">${esc(r.city)}</span>
        </div>
      </div>
      <div class="cta">
        <p class="cta-lead">当社の取扱条件</p>
        <ul class="cta-list">
          <li>ご成約時に当社が賃貸借契約を結び、入居者さまへ転貸する<b>転貸型</b>のお部屋です</li>
          <li>賃料＝本来の募集賃料の<b>20%増＋見守りサービス 5,000円</b></li>
          <li>礼金＝本来の条件<b>＋1ヶ月</b></li>
          <li>見守りサービスは保証会社の保証に付帯する形でご提供します</li>
        </ul>
        <p class="note">お問い合わせの際は物件番号「${esc(r.id)}」をお知らせください。</p>
      </div>
    </div>
    <h2 class="section-title">お部屋の概要</h2>
    <table class="spec-table">${rows.map((x) =>
      `<tr><th>${x[0]}</th><td>${x[1]}</td><th>${x[2]}</th><td>${x[3]}</td></tr>`).join("")}</table>
    <p class="update-note">情報更新日：${d.updated.replaceAll("-", "/")}　次回更新予定日：${d.next_update.replaceAll("-", "/")}<br>
    ※賃料には見守りサービス料を含みます。当社が貸主（転貸人）となる条件でのご案内です。<br>
    ※掲載情報と現況が異なる場合は現況を優先します。ご成約済みの場合はご容赦ください。</p>`;
}
