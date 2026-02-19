/* MITTI ShopHelper v2 + NEON UX
   - サウンド（WebAudioで生成）BGM / SFX
   - タブ下線アニメ・画面遷移アニメ
   - 文言：操作系は短く、説明文は丁寧に
*/

const STORAGE_KEY = "mitti_shophelper_v2";
const SOUND_KEY = "mitti_shophelper_sound_v1";

const $ = (id) => document.getElementById(id);
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const safeInt = (v, d=0) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.trunc(n) : d;
};
const safeNum = (v, d=0) => {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : d;
};
const yen = (n) => `${Math.round(n).toLocaleString("ja-JP")}円`;

const uuid = () => {
  try { return crypto.randomUUID(); }
  catch { return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
};

const TAX_RATES = [
  { label: "8%", value: 0.08 },
  { label: "10%", value: 0.10 },
];

function roundTo(value, method, unit = 1){
  const u = Math.max(1, Number(unit) || 1);
  const x = value / u;
  let y = x;
  if (method === "FLOOR") y = Math.floor(x);
  else if (method === "CEIL") y = Math.ceil(x);
  else y = Math.round(x);
  return y * u;
}

function nowISO(){ return new Date().toISOString(); }

function defaultShopPolicy(preset){
  if (preset === "PRESET_RATE_GROUP"){
    return { aggregation:"RATE_GROUP_ROUND", roundingMethod:"ROUND", roundingUnit:1, inclToBaseRounding:"NONE" };
  }
  return { aggregation:"ITEM_ROUND", roundingMethod:"FLOOR", roundingUnit:1, inclToBaseRounding:"NONE" };
}

function defaultState(){
  return {
    version: 2,
    shops: [],
    selectedShopId: null,
    cart: [],
    cartSettings: { totalDiscount: { type:"NONE", value:0, target:"BASE" } },
    history: [],
    ui: { shopEditingId: null, lastVerifySuggestion: null }
  };
}

function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(!raw) return defaultState();
    const s = JSON.parse(raw);
    return { ...defaultState(), ...s };
  }catch{
    return defaultState();
  }
}
let _saveTimer = null;
let _saveWarned = false;
function saveStateNow(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){
    // 保存に失敗してもアプリが止まらないようにします（容量不足 / ブラウザ設定など）
    if(!_saveWarned){
      _saveWarned = true;
      alert(`端末への保存に失敗しました。
空き容量やブラウザ設定を確認してください。
（このまま使えますが、閉じると入力が消える可能性があります。）`);
    }
    console.warn("saveState failed:", e);
  }
}
function saveState(){
  // 既存呼び出し互換：即時保存
  saveStateNow();
}
function saveStateDebounced(ms = 150){
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveStateNow, ms);
}

let state = loadState();
// --- Mode (SIMPLE / PRO) ---
state.ui = state.ui || {};
state.ui.mode = state.ui.mode || "SIMPLE";

function applyModeToDom(){
  document.body.dataset.mode = state.ui.mode;
  const btn = document.getElementById("modeToggle");
  if (btn) btn.textContent = `モード：${state.ui.mode === "SIMPLE" ? "簡単" : "詳細"}`;
}

function normalizeForMode(){
  if (state.ui.mode !== "SIMPLE") return;

  // 簡単モードでは割引系を無効化（データは残るが計算には使わない）
  if (state.cartSettings?.totalDiscount){
    state.cartSettings.totalDiscount.type = "NONE";
    state.cartSettings.totalDiscount.value = 0;
    state.cartSettings.totalDiscount.target = "BASE";
  }
  state.cart = (state.cart || []).map(it => ({
    ...it,
    discountType: "NONE",
    discountValue: 0,
  }));
}

document.getElementById("modeToggle")?.addEventListener("click", () => {
  sfxClick?.();
  state.ui.mode = (state.ui.mode === "SIMPLE") ? "PRO" : "SIMPLE";
  normalizeForMode();
  saveState?.();
  applyModeToDom();

  // 画面を更新（関数が存在する前提）
  try{
    renderShopSelect?.();
    renderShopList?.();
    renderCart?.();
    renderTotals?.();
    renderHistory?.();
  }catch{}
});

// 起動時に反映
applyModeToDom();
normalizeForMode();

// --- SIMPLE: ultra settings ---
state.ui = state.ui || {};
state.ui.simple = state.ui.simple || { priceMode: "EXCL", defaultRate: 0.10 };

function isSimpleMode(){
  return state.ui?.mode === "SIMPLE";
}

function applySimpleBarUI(){
  const pmBtn = document.getElementById("simplePriceModeToggle");
  const b8 = document.getElementById("simpleDefaultRate8");
  const b10 = document.getElementById("simpleDefaultRate10");

  if (pmBtn){
    pmBtn.textContent = `価格：${state.ui.simple.priceMode === "INCL" ? "税込" : "税抜"}`;
  }
  if (b8){
    b8.setAttribute("aria-pressed", state.ui.simple.defaultRate === 0.08 ? "true" : "false");
    b8.disabled = (state.ui.simple.defaultRate === 0.08);
  }
  if (b10){
    b10.setAttribute("aria-pressed", state.ui.simple.defaultRate === 0.10 ? "true" : "false");
    b10.disabled = (state.ui.simple.defaultRate === 0.10);
  }
}

function applySimpleToAllItems(){
  if (!isSimpleMode()) return;
  state.cart = (state.cart || []).map(it => ({
    ...it,
    priceMode: state.ui.simple.priceMode,
    discountType: "NONE",
    discountValue: 0,
  }));
}

document.getElementById("simplePriceModeToggle")?.addEventListener("click", () => {
  sfxClick();
  state.ui.simple.priceMode = (state.ui.simple.priceMode === "EXCL") ? "INCL" : "EXCL";
  applySimpleToAllItems();
  saveState();
  applySimpleBarUI();
  renderCart();
  renderTotals();
});

document.getElementById("simpleDefaultRate8")?.addEventListener("click", () => {
  sfxClick();
  state.ui.simple.defaultRate = 0.08;
  saveState();
  applySimpleBarUI();
});

document.getElementById("simpleDefaultRate10")?.addEventListener("click", () => {
  sfxClick();
  state.ui.simple.defaultRate = 0.10;
  saveState();
  applySimpleBarUI();
});

/* ------------------------------
   サウンド（Web Audio）
-------------------------------- */
let audio = {
  ctx: null,
  master: null,
  bgmGain: null,
  sfxGain: null,
  isReady: false,
  isPlaying: false,
  scheduler: null,
  nodes: []
};

let soundPrefs = loadSoundPrefs();
function loadSoundPrefs(){
  try{
    const raw = localStorage.getItem(SOUND_KEY);
    if(!raw) return { bgm:false, sfx:true, volume:0.35 };
    const s = JSON.parse(raw);
    return {
      bgm: !!s.bgm,
      sfx: (s.sfx !== false),
      volume: clamp(Number(s.volume ?? 0.35), 0, 1)
    };
  }catch{
    return { bgm:false, sfx:true, volume:0.35 };
  }
}
function saveSoundPrefs(){
  localStorage.setItem(SOUND_KEY, JSON.stringify(soundPrefs));
}

function ensureAudio(){
  if (audio.isReady) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return;

  audio.ctx = new Ctx();
  audio.master = audio.ctx.createGain();
  audio.bgmGain = audio.ctx.createGain();
  audio.sfxGain = audio.ctx.createGain();

  audio.master.gain.value = soundPrefs.volume;
  audio.bgmGain.gain.value = 0.32;
  audio.sfxGain.gain.value = 0.90;

  audio.bgmGain.connect(audio.master);
  audio.sfxGain.connect(audio.master);
  audio.master.connect(audio.ctx.destination);

  audio.isReady = true;
}

function setMasterVolume(v01){
  soundPrefs.volume = clamp(v01, 0, 1);
  saveSoundPrefs();
  if (audio.master) audio.master.gain.value = soundPrefs.volume;
}

function sfxClick(){
  if (!soundPrefs.sfx) return;
  ensureAudio();
  if (!audio.isReady) return;
  if (audio.ctx.state === "suspended") audio.ctx.resume().catch(()=>{});

  const t = audio.ctx.currentTime;
  const o = audio.ctx.createOscillator();
  const g = audio.ctx.createGain();
  o.type = "triangle";
  o.frequency.setValueAtTime(880, t);
  o.frequency.exponentialRampToValueAtTime(440, t + 0.07);

  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.12, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);

  o.connect(g);
  g.connect(audio.sfxGain);
  o.start(t);
  o.stop(t + 0.12);
}

function startBgm(){
  ensureAudio();
  if (!audio.isReady) return;
  if (audio.isPlaying) return;

  if (audio.ctx.state === "suspended") audio.ctx.resume().catch(()=>{});

  const filter = audio.ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 1200;
  filter.Q.value = 0.8;

  filter.connect(audio.bgmGain);

  const tempo = 78;
  const stepSec = 60 / tempo * 2;

  const chords = [
    [220.00, 261.63, 329.63],
    [196.00, 246.94, 293.66],
    [174.61, 220.00, 261.63],
    [196.00, 246.94, 293.66],
  ];

  function playChord(freqs, time){
    freqs.forEach((f, i) => {
      const o = audio.ctx.createOscillator();
      const g = audio.ctx.createGain();
      o.type = (i === 0) ? "sine" : "triangle";
      o.frequency.setValueAtTime(f, time);

      g.gain.setValueAtTime(0.0001, time);
      g.gain.exponentialRampToValueAtTime(0.10, time + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, time + stepSec * 0.95);

      const lfo = audio.ctx.createOscillator();
      const lfoG = audio.ctx.createGain();
      lfo.type = "sine";
      lfo.frequency.setValueAtTime(0.15 + i*0.03, time);
      lfoG.gain.setValueAtTime(2.5, time);
      lfo.connect(lfoG);
      lfoG.connect(o.frequency);

      o.connect(g);
      g.connect(filter);

      o.start(time);
      o.stop(time + stepSec * 0.98);
      lfo.start(time);
      lfo.stop(time + stepSec * 0.98);

      audio.nodes.push(o, g, lfo, lfoG);
    });

    const bell = audio.ctx.createOscillator();
    const bellG = audio.ctx.createGain();
    bell.type = "sine";
    bell.frequency.setValueAtTime(freqs[2] * 2, time + 0.02);
    bellG.gain.setValueAtTime(0.0001, time);
    bellG.gain.exponentialRampToValueAtTime(0.06, time + 0.03);
    bellG.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
    bell.connect(bellG);
    bellG.connect(filter);
    bell.start(time);
    bell.stop(time + 0.28);
    audio.nodes.push(bell, bellG);
  }

  let idx = 0;
  const scheduleAhead = 0.25;

  audio.scheduler = setInterval(() => {
    const now = audio.ctx.currentTime;
    const t = now + scheduleAhead;
    const chord = chords[idx % chords.length];
    playChord(chord, t);
    idx++;
  }, stepSec * 1000);

  audio.isPlaying = true;
}

function stopBgm(){
  if (audio.scheduler) clearInterval(audio.scheduler);
  audio.scheduler = null;

  audio.nodes.forEach(n => {
    try{
      if (n.stop) n.stop();
      if (n.disconnect) n.disconnect();
    }catch{}
  });
  audio.nodes = [];
  audio.isPlaying = false;
}

/* ------------------------------
   計算ロジック
-------------------------------- */
function inclToBase(priceIncl, rate){ return priceIncl / (1 + rate); }

function itemBaseBeforeDiscount(item, shopPolicy){
  const rate = Number(item.rate);
  const qty = Math.max(1, safeInt(item.qty, 1));
  const price = Math.max(0, safeNum(item.price, 0));
  const mode = item.priceMode || "EXCL";

  let base = (mode === "INCL") ? inclToBase(price, rate) : price;

  const r = shopPolicy.inclToBaseRounding || "NONE";
  if (mode === "INCL" && r !== "NONE"){
    base = roundTo(base, r, 1);
  }
  return Math.max(0, base * qty);
}

function applyLineDiscount(base, item){
  const type = item.discountType || "NONE";
  const valueRaw = safeNum(item.discountValue, 0);

  if (type === "PERCENT"){
    const p = clamp(valueRaw, 0, 100);
    return Math.max(0, base * (1 - p / 100));
  }
  if (type === "YEN"){
    const y = Math.max(0, valueRaw);
    return Math.max(0, base - y);
  }
  return Math.max(0, base);
}

function applyTotalDiscountToBases(basesByItem, totalDiscount){
  const { type, value } = totalDiscount;
  const v = safeNum(value, 0);

  if (type === "PERCENT"){
    const p = clamp(v, 0, 100);
    const f = (1 - p / 100);
    return basesByItem.map(x => ({ ...x, base: Math.max(0, x.base * f) }));
  }

  if (type === "YEN"){
    let discount = Math.max(0, v);
    const totalBase = basesByItem.reduce((a, b) => a + b.base, 0);
    if (totalBase <= 0) return basesByItem;

    if (discount >= totalBase){
      return basesByItem.map(x => ({ ...x, base: 0 }));
    }

    const out = basesByItem.map(x => ({ ...x }));
    let allocated = 0;

    for (let i = 0; i < out.length; i++){
      if (i === out.length - 1) break;
      const share = out[i].base / totalBase;
      const d = discount * share;
      const newBase = Math.max(0, out[i].base - d);
      allocated += (out[i].base - newBase);
      out[i].base = newBase;
    }

    const last = out[out.length - 1];
    const remain = Math.max(0, discount - allocated);
    last.base = Math.max(0, last.base - remain);

    return out;
  }

  return basesByItem;
}

function computeTotalsByPolicy(itemsWithBases, shop){
  const policy = shop.policy;
  const method = policy.roundingMethod;
  const unit = Number(policy.roundingUnit) || 1;
  const aggregation = policy.aggregation;

  if (aggregation === "ITEM_ROUND"){
    let subtotal = 0;
    let total = 0;

    for (const it of itemsWithBases){
      const rate = Number(it.rate);
      const base = Math.max(0, it.base);

      const baseRounded = roundTo(base, method, unit);
      const totalRounded = roundTo(base * (1 + rate), method, unit);

      subtotal += baseRounded;
      total += totalRounded;
    }

    const tax = Math.max(0, total - subtotal);
    return { subtotal, tax, total };
  }

  const baseByRate = new Map();
  for (const it of itemsWithBases){
    const rate = Number(it.rate);
    baseByRate.set(rate, (baseByRate.get(rate) ?? 0) + Math.max(0, it.base));
  }

  let subtotal = 0;
  let total = 0;

  for (const [rate, baseSum] of baseByRate.entries()){
    const baseRounded = roundTo(baseSum, method, unit);
    const totalRounded = roundTo(baseSum * (1 + rate), method, unit);
    subtotal += baseRounded;
    total += totalRounded;
  }

  const tax = Math.max(0, total - subtotal);
  return { subtotal, tax, total };
}

function policyNote(shop){
  const p = shop.policy;
  const agg = p.aggregation === "ITEM_ROUND" ? "商品ごとに丸めます。" : "税率ごとにまとめて丸めます。";
  const rm = p.roundingMethod === "FLOOR" ? "切り捨てします。" : p.roundingMethod === "CEIL" ? "切り上げします。" : "四捨五入します。";
  const unit = `${p.roundingUnit}円単位`;
  const incl = p.inclToBaseRounding === "NONE" ? "丸めません。" :
    p.inclToBaseRounding === "FLOOR" ? "切り捨てします。" :
    p.inclToBaseRounding === "CEIL" ? "切り上げします。" : "四捨五入します。";
  return `計算方式：${agg}　端数：${rm}（${unit}）　税込→税抜：${incl}　`;
}

function computeTransaction(shop, cart, cartSettings){
  if (!shop) {
    return { ok:false, note:"店が未登録のため、計算できません。", subtotal:0, tax:0, totalBeforeDiscount:0, discountAmount:0, payTotal:0 };
  }
  if (!cart || cart.length === 0){
    return { ok:false, note:"商品が未入力です。", subtotal:0, tax:0, totalBeforeDiscount:0, discountAmount:0, payTotal:0 };
  }

  const enabledRates = new Set(shop.ratesEnabled.filter(Boolean));
  const normalized = cart.map(it => {
    const rate = Number(it.rate);
    const fixedRate = enabledRates.has(rate) ? rate : (shop.ratesEnabled[0] ?? 0.10);
    return { ...it, rate: fixedRate };
  });

  const basesByItem = normalized.map(it => {
    const base0 = itemBaseBeforeDiscount(it, shop.policy);
    const base1 = applyLineDiscount(base0, it);
    return { id: it.id, rate:Number(it.rate), base: base1, original: it };
  });

  const totalsBefore = computeTotalsByPolicy(basesByItem, shop);

  const td = cartSettings?.totalDiscount ?? { type:"NONE", value:0, target:"BASE" };
  const type = td.type || "NONE";
  const target = td.target || "BASE";
  const value = safeNum(td.value, 0);

  let subtotal = totalsBefore.subtotal;
  let tax = totalsBefore.tax;
  let totalBeforeDiscount = totalsBefore.total;
  let discountAmount = 0;
  let payTotal = totalBeforeDiscount;
  let note = "";

  if (type === "NONE" || value <= 0){
    note = policyNote(shop);
    return { ok:true, note, subtotal, tax, totalBeforeDiscount, discountAmount:0, payTotal: totalBeforeDiscount };
  }

  if (target === "BASE"){
    const adjusted = applyTotalDiscountToBases(basesByItem, { type, value });
    const totalsAfter = computeTotalsByPolicy(adjusted, shop);
    subtotal = totalsAfter.subtotal;
    tax = totalsAfter.tax;
    payTotal = totalsAfter.total;
    discountAmount = Math.max(0, totalBeforeDiscount - payTotal);
    note = policyNote(shop) + "合計割引は、税抜合計に適用しています。";
  } else {
    let t = totalBeforeDiscount;
    if (type === "PERCENT"){
      const p = clamp(value, 0, 100);
      t = Math.max(0, t * (1 - p / 100));
      t = roundTo(t, shop.policy.roundingMethod, 1);
    } else if (type === "YEN"){
      t = Math.max(0, t - Math.max(0, value));
    }
    payTotal = Math.round(t);
    discountAmount = Math.max(0, totalBeforeDiscount - payTotal);
    note = policyNote(shop) + "合計割引は、税込合計に適用しています。税額は参考値です。";
  }

  return { ok:true, note, subtotal, tax, totalBeforeDiscount, discountAmount, payTotal };
}

/* ------------------------------
   UI：画面切替・タブ下線
-------------------------------- */
function setScreen(name){
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("is-active","enter"));
  const target = document.querySelector(`#screen-${name}`);
  target?.classList.add("is-active","enter");

  document.querySelectorAll(".tab").forEach(t => t.classList.remove("is-active"));
  const tab = document.querySelector(`.tab[data-screen="${name}"]`);
  tab?.classList.add("is-active");

  requestAnimationFrame(() => moveUnderline(tab));
}

function moveUnderline(tab){
  const ul = document.querySelector(".tab-underline");
  if (!ul || !tab) return;
  const tabs = document.querySelector(".tabs");
  if (!tabs) return;
  const r1 = tabs.getBoundingClientRect();
  const r2 = tab.getBoundingClientRect();
  const x = r2.left - r1.left;
  ul.style.transform = `translateX(${x}px)`;
  ul.style.width = `${r2.width}px`;
}

/* ------------------------------
   UI：店
-------------------------------- */
function getSelectedShop(){
  return state.shops.find(s => s.id === state.selectedShopId) ?? null;
}

function renderShopSelect(){
  const sel = $("shopSelect");
  sel.innerHTML = "";

  if (state.shops.length === 0){
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "店が未登録です";
    sel.appendChild(opt);
    sel.disabled = true;
    $("policySummary").textContent = "—";
    $("shopMemoView").textContent = "「店」タブで店プロフィールを登録してください。";
    return;
  }

  sel.disabled = false;
  for (const shop of state.shops){
    const opt = document.createElement("option");
    opt.value = shop.id;
    opt.textContent = shop.name;
    sel.appendChild(opt);
  }

  if (!state.selectedShopId || !state.shops.some(s => s.id === state.selectedShopId)){
    state.selectedShopId = state.shops[0].id;
    saveState();
  }
  sel.value = state.selectedShopId;

  const shop = getSelectedShop();
  $("policySummary").textContent = policyNote(shop).trim();
  $("shopMemoView").textContent = shop.memo ? `メモ：${shop.memo}` : "";
}

function applyPresetToForm(preset){
  if (preset === "PRESET_RATE_GROUP"){
    $("aggregation").value = "RATE_GROUP_ROUND";
    $("roundingMethod").value = "ROUND";
    $("roundingUnit").value = "1";
    $("inclToBaseRounding").value = "NONE";
    return;
  }
  if (preset === "PRESET_ITEM_ROUND"){
    $("aggregation").value = "ITEM_ROUND";
    $("roundingMethod").value = "FLOOR";
    $("roundingUnit").value = "1";
    $("inclToBaseRounding").value = "NONE";
  }
}

function readShopForm(){
  const name = $("shopName").value.trim();
  const memo = $("shopMemo").value.trim();
  const rate8 = $("rate8").checked;
  const rate10 = $("rate10").checked;

  const enabled = [];
  if (rate8) enabled.push(0.08);
  if (rate10) enabled.push(0.10);
  if (enabled.length === 0){
    enabled.push(0.10);
    $("rate10").checked = true;
  }

  const preset = $("preset").value;
  const policy = {
    aggregation: $("aggregation").value,
    roundingMethod: $("roundingMethod").value,
    roundingUnit: Number($("roundingUnit").value) || 1,
    inclToBaseRounding: $("inclToBaseRounding").value,
  };
  return { name, memo, preset, policy, ratesEnabled: enabled };
}

function writeShopForm(shop){
  $("shopName").value = shop.name;
  $("shopMemo").value = shop.memo || "";
  $("rate8").checked = shop.ratesEnabled.includes(0.08);
  $("rate10").checked = shop.ratesEnabled.includes(0.10);

  $("preset").value = shop.preset || "CUSTOM";
  $("aggregation").value = shop.policy.aggregation;
  $("roundingMethod").value = shop.policy.roundingMethod;
  $("roundingUnit").value = String(shop.policy.roundingUnit ?? 1);
  $("inclToBaseRounding").value = shop.policy.inclToBaseRounding ?? "NONE";
}

function resetShopForm(){
  state.ui.shopEditingId = null;
  saveState();

  $("shopName").value = "";
  $("shopMemo").value = "";
  $("rate8").checked = true;
  $("rate10").checked = true;

  $("preset").value = "PRESET_ITEM_ROUND";
  applyPresetToForm("PRESET_ITEM_ROUND");

  $("saveShop").textContent = "登録";
  $("cancelEdit").classList.add("is-hidden");
}

function renderShopList(){
  const wrap = $("shopList");
  wrap.innerHTML = "";

  if (state.shops.length === 0){
    wrap.innerHTML = `<div class="muted">店が未登録です。上のフォームから登録してください。</div>`;
    return;
  }

  for (const shop of state.shops){
    const div = document.createElement("div");
    div.className = "list-item";

    const ratesTxt = shop.ratesEnabled.map(r => `${Math.round(r*100)}%`).join(" / ");
    const pTxt = policyNote(shop).trim();

    div.innerHTML = `
      <div class="list-top">
        <div>
          <strong>${escapeHtml(shop.name)}</strong>
          <div class="list-meta">税率：${escapeHtml(ratesTxt)}\n${escapeHtml(pTxt)}${shop.memo ? `\nメモ：${escapeHtml(shop.memo)}` : ""}</div>
        </div>
        <div class="row wrap">
          <button class="btn ghost" data-act="use" type="button">使う</button>
          <button class="btn ghost" data-act="edit" type="button">編集</button>
          <button class="btn danger" data-act="del" type="button">削除</button>
        </div>
      </div>
    `;

    div.querySelector('[data-act="use"]').addEventListener("click", () => {
      sfxClick();
      state.selectedShopId = shop.id;
      saveState();
      renderShopSelect();
      renderCart();
      renderTotals();
      setScreen("calc");
    });

    div.querySelector('[data-act="edit"]').addEventListener("click", () => {
      sfxClick();
      state.ui.shopEditingId = shop.id;
      saveState();
      writeShopForm(shop);
      $("saveShop").textContent = "更新";
      $("cancelEdit").classList.remove("is-hidden");
      setScreen("shops");
    });

    div.querySelector('[data-act="del"]').addEventListener("click", () => {
      sfxClick();
      if (!confirm("この店プロフィールを削除しますか？")) return;
      state.shops = state.shops.filter(s => s.id !== shop.id);
      if (state.selectedShopId === shop.id){
        state.selectedShopId = state.shops[0]?.id ?? null;
      }
      saveState();
      renderShopSelect();
      renderShopList();
      renderTotals();
    });

    wrap.appendChild(div);
  }
}

/* ------------------------------
   UI：カート
-------------------------------- */
function defaultItem(rate = 0.10){
  return {
    id: uuid(),
    name: "",
    price: 0,
    priceMode: "EXCL",
    rate: rate,
    qty: 1,
    discountType: "NONE",
    discountValue: 0,
  };
}

function renderCart(){
  const wrap = $("itemList");
  wrap.innerHTML = "";

  const shop = getSelectedShop();
  const enabledRates = shop ? shop.ratesEnabled : [0.10];

  if (state.cart.length === 0){
    wrap.innerHTML = `<div class="muted">商品が未入力です。「商品追加」から入力してください。</div>`;
    return;
  }

  for (const item of state.cart){
    const div = document.createElement("div");
    div.className = "item";

    const title = item.name?.trim() ? item.name.trim() : "（名称未入力）";

    div.innerHTML = `
      <div class="item-head">
        <div class="item-title">${escapeHtml(title)}</div>
        <div class="item-actions">
          <button class="icon-btn" title="この商品を削除" type="button">×</button>
        </div>
      </div>

      <div class="item-grid">
        <label class="field">
          <span>商品名</span>
          <input data-k="name" value="${escapeAttr(item.name ?? "")}" placeholder="例：牛乳" />
        </label>

        <label class="field">
          <span>価格（円）</span>
          <input data-k="price" inputmode="numeric" value="${escapeAttr(String(item.price ?? ""))}" placeholder="0" />
        </label>

        <label class="field">
          <span>数量</span>
          <input data-k="qty" inputmode="numeric" value="${escapeAttr(String(item.qty ?? 1))}" placeholder="1" />
        </label>

        <label class="field">
          <span>価格の種類</span>
          <select data-k="priceMode">
            <option value="EXCL">税抜</option>
            <option value="INCL">税込</option>
          </select>
        </label>

        <label class="field">
          <span>税率</span>
          <select data-k="rate"></select>
        </label>

        <label class="field">
          <span>行割引</span>
          <select data-k="discountType">
            <option value="NONE">なし</option>
            <option value="PERCENT">％引き</option>
            <option value="YEN">円引き</option>
          </select>
        </label>
      </div>

      <div class="item-grid2">
        <label class="field">
          <span>行割引の値</span>
          <input data-k="discountValue" inputmode="numeric" value="${escapeAttr(String(item.discountValue ?? ""))}" placeholder="例：5（％） または 100（円）" />
        </label>

        <div class="note">
          <div class="note-title">行割引の説明</div>
          <div class="note-body">行割引は、税抜金額（数量を反映した行合計）に対して適用します。</div>
        </div>
      </div>
    `;

    const priceModeSel = div.querySelector('select[data-k="priceMode"]');
    priceModeSel.value = item.priceMode || "EXCL";

    const rateSel = div.querySelector('select[data-k="rate"]');
    rateSel.innerHTML = "";
    for (const r of TAX_RATES){
      if (!enabledRates.includes(r.value)) continue;
      const opt = document.createElement("option");
      opt.value = String(r.value);
      opt.textContent = r.label;
      rateSel.appendChild(opt);
    }
    if (!enabledRates.includes(Number(item.rate))){
      item.rate = enabledRates[0] ?? 0.10;
      saveState();
    }
    rateSel.value = String(item.rate);

    const discTypeSel = div.querySelector('select[data-k="discountType"]');
    discTypeSel.value = item.discountType || "NONE";

    div.querySelectorAll("input, select").forEach(el => {
      const k = el.dataset.k;
      if (!k) return;

      el.addEventListener("input", () => {
        const target = state.cart.find(c => c.id === item.id);
        if (!target) return;

        if (k === "price" || k === "qty" || k === "discountValue" || k === "rate"){
          if (k === "qty") target[k] = Math.max(1, safeInt(el.value, 1));
          else if (k === "price") target[k] = Math.max(0, safeNum(el.value, 0));
          else if (k === "discountValue") target[k] = Math.max(0, safeNum(el.value, 0));
          else if (k === "rate") target[k] = Number(el.value);
        } else {
          target[k] = el.value;
        }

        // 入力中は再描画しない（フォーカスが飛ぶのを防ぐ）
        // 状態だけ更新し、合計だけ再計算します。
        saveStateDebounced();

        if (k === "name"){
          const t = target.name?.trim() ? target.name.trim() : "（名称未入力）";
          const titleEl = div.querySelector(".item-title");
          if (titleEl) titleEl.textContent = t;
        }

        renderTotals();
      });
    });

    div.querySelector(".icon-btn").addEventListener("click", () => {
      sfxClick();
      state.cart = state.cart.filter(c => c.id !== item.id);
      saveState();
      renderCart();
      renderTotals();
    });

    wrap.appendChild(div);
  }
}

/* ------------------------------
   UI：合計
-------------------------------- */
function syncDiscountUIFromState(){
  const td = state.cartSettings.totalDiscount;
  $("totalDiscountType").value = td.type || "NONE";
  $("totalDiscountValue").value = (td.value ?? 0) ? String(td.value) : "";
  $("totalDiscountTarget").value = td.target || "BASE";
}

function renderTotals(){
  const shop = getSelectedShop();

  const td = state.cartSettings.totalDiscount;
  td.type = $("totalDiscountType").value;
  td.value = safeNum($("totalDiscountValue").value, 0);
  td.target = $("totalDiscountTarget").value;
  saveStateDebounced();

  const res = computeTransaction(shop, state.cart, state.cartSettings);

  $("subtotal").textContent = yen(res.subtotal);
  $("tax").textContent = yen(res.tax);
  $("totalBefore").textContent = yen(res.totalBeforeDiscount);
  $("discount").textContent = yen(res.discountAmount);
  $("payTotal").textContent = yen(res.payTotal);
  $("calcNote").textContent = res.note;
}

/* ------------------------------
   履歴
-------------------------------- */
function renderHistory(){
  const wrap = $("historyList");
  wrap.innerHTML = "";

  if (state.history.length === 0){
    wrap.innerHTML = `<div class="muted">履歴がありません。</div>`;
    return;
  }

  for (const h of [...state.history].reverse()){
    const div = document.createElement("div");
    div.className = "list-item";

    const dt = new Date(h.at);
    const dtText = dt.toLocaleString("ja-JP");

    div.innerHTML = `
      <div class="list-top">
        <div>
          <strong>${escapeHtml(h.shopSnapshot?.name ?? "（店情報なし）")}</strong>
          <div class="list-meta">${escapeHtml(dtText)}</div>
        </div>
        <div style="text-align:right;">
          <div><strong>${yen(h.result?.payTotal ?? 0)}</strong></div>
          <div class="list-meta">小計：${yen(h.result?.subtotal ?? 0)}　税額：${yen(h.result?.tax ?? 0)}</div>
        </div>
      </div>

      <div class="list-meta">商品数：${(h.itemsSnapshot?.length ?? 0)}件　割引：${yen(h.result?.discountAmount ?? 0)}</div>

      <div class="row wrap" style="margin-top:10px;">
        <button class="btn ghost" data-act="detail" type="button">詳細</button>
        <button class="btn ghost" data-act="load" type="button">読み込む</button>
        <button class="btn danger" data-act="del" type="button">削除</button>
      </div>

      <div class="list-meta" data-detail style="display:none; margin-top:10px;"></div>
    `;

    const detail = div.querySelector("[data-detail]");

    div.querySelector('[data-act="detail"]').addEventListener("click", () => {
      sfxClick();
      const open = detail.style.display !== "none";
      if (open){
        detail.style.display = "none";
        return;
      }
      detail.style.display = "block";

      const lines = [];
      lines.push(`計算ルール：${policyNote(h.shopSnapshot).trim()}`);
      lines.push("商品：");
      for (const it of (h.itemsSnapshot ?? [])){
        const rate = `${Math.round(Number(it.rate)*100)}%`;
        const mode = it.priceMode === "INCL" ? "税込" : "税抜";
        const disc = (it.discountType && it.discountType !== "NONE")
          ? ` / 行割引：${it.discountType === "PERCENT" ? `${it.discountValue}%` : `${it.discountValue}円`}`
          : "";
        lines.push(`・${it.name || "（名称なし）"}：${it.price}円（${mode}）×${it.qty} / 税率：${rate}${disc}`);
      }
      detail.textContent = lines.join("\n");
    });

    div.querySelector('[data-act="load"]').addEventListener("click", () => {
      sfxClick();
      const snap = h.shopSnapshot;
      if (snap){
        let shop = state.shops.find(s => s.id === snap.id);
        if (!shop){
          shop = { ...snap, id: uuid(), restoredFromHistory: true, createdAt: nowISO(), updatedAt: nowISO() };
          state.shops.push(shop);
        }
        state.selectedShopId = shop.id;
      }

      state.cart = (h.itemsSnapshot ?? []).map(x => ({ ...x, id: uuid() }));
      state.cartSettings = h.cartSettingsSnapshot ?? state.cartSettings;

      saveState();
      renderShopSelect();
      syncDiscountUIFromState();
      renderCart();
      renderTotals();
      setScreen("calc");
      alert("履歴を読み込みました。");
    });

    div.querySelector('[data-act="del"]').addEventListener("click", () => {
      sfxClick();
      if (!confirm("この履歴を削除しますか？")) return;
      state.history = state.history.filter(x => x.id !== h.id);
      saveState();
      renderHistory();
    });

    wrap.appendChild(div);
  }
}

/* ------------------------------
   検証（簡易）
-------------------------------- */
function suggestPoliciesForReceipt(shop, cart, cartSettings, receiptTotal){
  const receipt = safeInt(receiptTotal, -1);
  if (receipt < 0) return { matches: [], closest: [] };

  const aggregations = ["ITEM_ROUND", "RATE_GROUP_ROUND"];
  const methods = ["FLOOR", "ROUND", "CEIL"];
  const units = [1, 10, 100];
  const inclRounds = ["NONE", "FLOOR", "ROUND", "CEIL"];

  const candidates = [];

  for (const ag of aggregations){
    for (const rm of methods){
      for (const u of units){
        for (const ir of inclRounds){
          const tmpShop = {
            ...shop,
            policy: { ...shop.policy, aggregation: ag, roundingMethod: rm, roundingUnit: u, inclToBaseRounding: ir }
          };
          const res = computeTransaction(tmpShop, cart, cartSettings);
          const diff = Math.abs(res.payTotal - receipt);
          candidates.push({ policy: tmpShop.policy, payTotal: res.payTotal, diff });
        }
      }
    }
  }

  const matches = candidates.filter(c => c.diff === 0).slice(0, 8);
  const closest = candidates.sort((a,b)=>a.diff-b.diff).slice(0, 8);
  return { matches, closest };
}

function policyShort(p){
  const ag = p.aggregation === "ITEM_ROUND" ? "商品ごと" : "税率ごと";
  const rm = p.roundingMethod === "FLOOR" ? "切り捨て" : p.roundingMethod === "CEIL" ? "切り上げ" : "四捨五入";
  const u = `${p.roundingUnit}円`;
  const ir = p.inclToBaseRounding === "NONE" ? "なし" :
    p.inclToBaseRounding === "FLOOR" ? "切り捨て" :
    p.inclToBaseRounding === "CEIL" ? "切り上げ" : "四捨五入";
  return `方式：${ag} / 端数：${rm}（${u}）/ 税込→税抜：${ir}`;
}

/* ------------------------------
   エクスポート / インポート
-------------------------------- */
function exportJson(filename, obj){
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function handleImportFile(file){
  const reader = new FileReader();
  reader.onload = () => {
    try{
      const json = JSON.parse(String(reader.result || "{}"));
      if (json.kind !== "MITTI_SHOPHELPER_EXPORT" || !Array.isArray(json.shops)){
        alert("インポートできませんでした。ファイル形式を確認してください。");
        return;
      }

      const modeReplace = confirm("インポートします。既存の店プロフィールを置き換えますか？\nOK：置き換え / キャンセル：追加");
      const incoming = json.shops.map(s => normalizeImportedShop(s));

      if (modeReplace){
        state.shops = incoming;
        state.selectedShopId = incoming[0]?.id ?? null;
      } else {
        state.shops.push(...incoming);
        if (!state.selectedShopId) state.selectedShopId = state.shops[0]?.id ?? null;
      }

      saveState();
      renderShopSelect();
      renderShopList();
      renderTotals();
      alert("インポートしました。");
    }catch{
      alert("インポートできませんでした。ファイル内容を確認してください。");
    }
  };
  reader.readAsText(file);
}
function normalizeImportedShop(s){
  const policy = {
    aggregation: s.policy?.aggregation === "RATE_GROUP_ROUND" ? "RATE_GROUP_ROUND" : "ITEM_ROUND",
    roundingMethod: ["ROUND","FLOOR","CEIL"].includes(s.policy?.roundingMethod) ? s.policy.roundingMethod : "ROUND",
    roundingUnit: [1,10,100].includes(Number(s.policy?.roundingUnit)) ? Number(s.policy.roundingUnit) : 1,
    inclToBaseRounding: ["NONE","ROUND","FLOOR","CEIL"].includes(s.policy?.inclToBaseRounding) ? s.policy.inclToBaseRounding : "NONE",
  };

  const ratesEnabled = [];
  if (Array.isArray(s.ratesEnabled)){
    if (s.ratesEnabled.includes(0.08)) ratesEnabled.push(0.08);
    if (s.ratesEnabled.includes(0.10)) ratesEnabled.push(0.10);
  }
  if (ratesEnabled.length === 0) ratesEnabled.push(0.10);

  return {
    id: uuid(),
    name: String(s.name || "（店名なし）"),
    memo: String(s.memo || ""),
    preset: s.preset || "CUSTOM",
    policy,
    ratesEnabled,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
}

/* ------------------------------
   HTMLエスケープ
-------------------------------- */
function escapeHtml(s){
  // replaceAll 非対応ブラウザでも動くように、正規表現でエスケープします
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
function escapeAttr(s){
  return escapeHtml(s).replace(/\n/g, " ");
}

/* ------------------------------
   イベント
-------------------------------- */
document.querySelectorAll(".tab").forEach(btn => {
  btn.addEventListener("click", () => {
    sfxClick();
    setScreen(btn.dataset.screen);
  });
});

$("goShops").addEventListener("click", () => { sfxClick(); setScreen("shops"); });

$("shopSelect").addEventListener("change", (e) => {
  sfxClick();
  state.selectedShopId = e.target.value;
  saveState();
  renderShopSelect();
  renderCart();
  renderTotals();
});

$("addItem").addEventListener("click", () => {
  sfxClick();
  const shop = getSelectedShop();
  const enabled = shop?.ratesEnabled ?? [0.10];

  // 追加時の税率（簡単モードなら defaultRate を優先）
  let rate = enabled[0] ?? 0.10;
  if (isSimpleMode()){
    const want = state.ui.simple.defaultRate ?? 0.10;
    rate = enabled.includes(want) ? want : (enabled[0] ?? 0.10);
  }

  const it = defaultItem(rate);

  // 簡単モードなら税込/税抜を一括適用
  if (isSimpleMode()){
    it.priceMode = state.ui.simple.priceMode;
    it.discountType = "NONE";
    it.discountValue = 0;
  }

  state.cart.push(it);
  saveState();
  renderCart();
  renderTotals();
});

$("clearCart").addEventListener("click", () => {
  sfxClick();
  if (!confirm("入力中の商品をすべて消去しますか？")) return;
  state.cart = [];
  saveState();
  renderCart();
  renderTotals();
});

$("totalDiscountType").addEventListener("change", () => renderTotals());
$("totalDiscountValue").addEventListener("input", () => renderTotals());
$("totalDiscountTarget").addEventListener("change", () => renderTotals());

$("saveHistory").addEventListener("click", () => {
  sfxClick();
  const shop = getSelectedShop();
  const res = computeTransaction(shop, state.cart, state.cartSettings);

  if (!shop || state.cart.length === 0){
    alert("店と商品を入力してから保存してください。");
    return;
  }

  const entry = {
    id: uuid(),
    at: Date.now(),
    shopSnapshot: JSON.parse(JSON.stringify(shop)),
    itemsSnapshot: JSON.parse(JSON.stringify(state.cart)),
    cartSettingsSnapshot: JSON.parse(JSON.stringify(state.cartSettings)),
    result: {
      subtotal: res.subtotal,
      tax: res.tax,
      totalBeforeDiscount: res.totalBeforeDiscount,
      discountAmount: res.discountAmount,
      payTotal: res.payTotal,
    }
  };

  state.history.push(entry);
  saveState();
  renderHistory();
  alert("履歴に保存しました。");
});

/* 店フォーム */
$("preset").addEventListener("change", () => {
  sfxClick();
  const preset = $("preset").value;
  if (preset !== "CUSTOM"){
    applyPresetToForm(preset);
  }
});

$("saveShop").addEventListener("click", () => {
  sfxClick();
  const form = readShopForm();
  if (!form.name){
    alert("店名を入力してください。");
    return;
  }

  const editingId = state.ui.shopEditingId;
  const ts = nowISO();

  if (editingId){
    const idx = state.shops.findIndex(s => s.id === editingId);
    if (idx >= 0){
      state.shops[idx] = { ...state.shops[idx], name: form.name, memo: form.memo, preset: form.preset, policy: form.policy, ratesEnabled: form.ratesEnabled, updatedAt: ts };
    }
    state.ui.shopEditingId = null;
    $("cancelEdit").classList.add("is-hidden");
    $("saveShop").textContent = "登録";
    alert("更新しました。");
  } else {
    const shop = { id: uuid(), name: form.name, memo: form.memo, preset: form.preset, policy: form.policy, ratesEnabled: form.ratesEnabled, createdAt: ts, updatedAt: ts };
    state.shops.push(shop);
    if (!state.selectedShopId) state.selectedShopId = shop.id;
    alert("登録しました。");
  }

  saveState();
  renderShopSelect();
  renderShopList();
  renderTotals();
  resetShopForm();
});

$("resetShop").addEventListener("click", () => { sfxClick(); resetShopForm(); });

$("cancelEdit").addEventListener("click", () => {
  sfxClick();
  resetShopForm();
  alert("編集をキャンセルしました。");
});

$("seedDemo").addEventListener("click", () => {
  sfxClick();
  const ts = nowISO();

  const demo1 = {
    id: uuid(),
    name: "例：商品ごと端数処理の店",
    memo: "商品ごとに税計算し、切り捨てします。",
    preset: "PRESET_ITEM_ROUND",
    policy: defaultShopPolicy("PRESET_ITEM_ROUND"),
    ratesEnabled: [0.08, 0.10],
    createdAt: ts,
    updatedAt: ts,
  };

  const demo2 = {
    id: uuid(),
    name: "例：税率ごと合計の店",
    memo: "税率ごとに合計してから、四捨五入します。",
    preset: "PRESET_RATE_GROUP",
    policy: defaultShopPolicy("PRESET_RATE_GROUP"),
    ratesEnabled: [0.08, 0.10],
    createdAt: ts,
    updatedAt: ts,
  };

  state.shops.push(demo1, demo2);
  if (!state.selectedShopId) state.selectedShopId = demo1.id;

  saveState();
  renderShopSelect();
  renderShopList();
  renderTotals();
  alert("例の店を追加しました。");
});

$("deleteAllShops").addEventListener("click", () => {
  sfxClick();
  if (!confirm("店プロフィールを全削除しますか？")) return;
  state.shops = [];
  state.selectedShopId = null;
  saveState();
  renderShopSelect();
  renderShopList();
  renderTotals();
});

$("exportAll").addEventListener("click", () => {
  sfxClick();
  exportJson("MITTI_ShopHelper_Shops.json", {
    kind: "MITTI_SHOPHELPER_EXPORT",
    version: 2,
    exportedAt: nowISO(),
    shops: state.shops,
  });
});

$("importFile").addEventListener("change", (e) => {
  sfxClick();
  const file = e.target.files?.[0];
  if (!file) return;
  handleImportFile(file);
  e.target.value = "";
});

/* 履歴 */
$("deleteAllHistory").addEventListener("click", () => {
  sfxClick();
  if (!confirm("履歴を全削除しますか？")) return;
  state.history = [];
  saveState();
  renderHistory();
});

/* 検証 */
$("runVerify").addEventListener("click", () => {
  sfxClick();
  const shop = getSelectedShop();
  if (!shop){ alert("店を登録してから検証してください。"); return; }
  if (state.cart.length === 0){ alert("商品を入力してから検証してください。"); return; }

  const receipt = safeInt($("receiptTotal").value, -1);
  if (receipt < 0){ alert("レシート合計を入力してください。"); return; }

  const current = computeTransaction(shop, state.cart, state.cartSettings);
  const diff = current.payTotal - receipt;

  const { matches, closest } = suggestPoliciesForReceipt(shop, state.cart, state.cartSettings, receipt);

  const box = $("verifyResult");
  box.innerHTML = "";

  const summary = document.createElement("div");
  summary.className = "list-item";
  summary.innerHTML = `
    <div class="list-top">
      <div>
        <strong>現在の計算結果</strong>
        <div class="list-meta">${escapeHtml(policyShort(shop.policy))}</div>
      </div>
      <div style="text-align:right;">
        <div><strong>${yen(current.payTotal)}</strong></div>
        <div class="list-meta">レシート：${yen(receipt)} / 差分：${yen(Math.abs(diff))}（${diff === 0 ? "一致" : (diff > 0 ? "多い" : "少ない")}）</div>
      </div>
    </div>
  `;
  box.appendChild(summary);

  const makeCandidateList = (title, arr, isMatch) => {
    const div = document.createElement("div");
    div.className = "list-item";
    const lines = arr.map((c, i) => {
      const badge = isMatch ? "一致" : `差分：${yen(c.diff)}`;
      return `(${i+1}) ${policyShort(c.policy)} / 計算：${yen(c.payTotal)} / ${badge}`;
    }).join("\n");
    div.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="list-meta">${escapeHtml(lines || "候補がありません。")}</div>`;
    box.appendChild(div);
  };

  if (matches.length > 0){
    makeCandidateList("一致する候補（上位）", matches, true);
    state.ui.lastVerifySuggestion = matches[0].policy;
    $("applySuggested").disabled = false;
  } else {
    makeCandidateList("近い候補（上位）", closest, false);
    state.ui.lastVerifySuggestion = closest[0]?.policy ?? null;
    $("applySuggested").disabled = !state.ui.lastVerifySuggestion;
  }
  saveState();
});

$("applySuggested").addEventListener("click", () => {
  sfxClick();
  const shop = getSelectedShop();
  const p = state.ui.lastVerifySuggestion;
  if (!shop || !p){ alert("適用できる候補がありません。"); return; }
  if (!confirm("候補の設定を、現在の店プロフィールに適用しますか？")) return;

  shop.policy = { ...shop.policy, ...p };
  shop.preset = "CUSTOM";
  shop.updatedAt = nowISO();

  saveState();
  renderShopSelect();
  renderShopList();
  renderTotals();
  alert("適用しました。");
});

/* ------------------------------
   サウンドUI
-------------------------------- */
function syncSoundUI(){
  $("bgmToggle").textContent = `BGM：${soundPrefs.bgm ? "ON" : "OFF"}`;
  $("sfxToggle").textContent = `効果音：${soundPrefs.sfx ? "ON" : "OFF"}`;
  $("bgmVolume").value = String(Math.round(soundPrefs.volume * 100));
}
$("bgmToggle").addEventListener("click", () => {
  sfxClick();
  soundPrefs.bgm = !soundPrefs.bgm;
  saveSoundPrefs();
  syncSoundUI();

  if (soundPrefs.bgm) startBgm();
  else stopBgm();
});
$("sfxToggle").addEventListener("click", () => {
  soundPrefs.sfx = !soundPrefs.sfx;
  saveSoundPrefs();
  syncSoundUI();
  sfxClick();
});
$("bgmVolume").addEventListener("input", (e) => {
  const v = clamp(Number(e.target.value) / 100, 0, 1);
  setMasterVolume(v);
});

/* ------------------------------
   初期化
-------------------------------- */
(function init(){
  requestAnimationFrame(() => {
    const tab = document.querySelector(".tab.is-active");
    moveUnderline(tab);
  });

  syncSoundUI();
  setMasterVolume(soundPrefs.volume);

  if (state.shops.length === 0){
    resetShopForm();
    setScreen("help");
  }

  syncDiscountUIFromState();

  renderShopSelect();
  renderShopList();
  renderCart();
  renderTotals();
  renderHistory();
  applySimpleBarUI();

  if (state.shops.length > 0 && state.cart.length === 0){
    const shop = getSelectedShop();
    const rate = shop?.ratesEnabled?.[0] ?? 0.10;
    state.cart.push(defaultItem(rate));
    saveStateNow();
    renderCart();
    renderTotals();
  }

  if (soundPrefs.bgm){
    soundPrefs.bgm = false;
    saveSoundPrefs();
    syncSoundUI();
  }
})();