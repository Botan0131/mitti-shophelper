/* MITTI ShopHelper NEON v1.0.0
   - PWA offline (sw.js)
   - SIMPLE / PRO mode
   - Shops (preset + advanced policy)
   - Cart calc (8% / 10%)
   - History (snapshot)
   - Verify (suggest rounding candidates) [PRO only]
   - Sound (WebAudio synth) BGM / SFX / volume

   ★入力が1文字ずつになる不具合対策：
   - inputイベントでは renderCart() を呼ばない
   - 画面を作り直すのは「追加/削除/店変更/読み込み」等のタイミングだけ
*/

(() => {
  "use strict";

  const VERSION = "1.0.0";
  const STORAGE_KEY = "mitti_shophelper_state_v1";
  const LEGACY_KEYS = ["mitti_shophelper_v2", "mitti_shophelper_v1", "mitti_shophelper_state"];
  const SOUND_KEY = "mitti_shophelper_sound_v1";

  const TAX = {
    R8: 0.08,
    R10: 0.10
  };

  const $ = (id) => document.getElementById(id);

  const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

  const safeNum = (v, d = 0) => {
    const s = String(v ?? "").replace(/[^\d.-]/g, "");
    const n = Number(s);
    return Number.isFinite(n) ? n : d;
  };
  const safeInt = (v, d = 0) => {
    const n = safeNum(v, d);
    return Number.isFinite(n) ? Math.trunc(n) : d;
  };

  const yen = (n) => `${Math.round(n).toLocaleString("ja-JP")}円`;

  const uuid = () => {
    try { return crypto.randomUUID(); }
    catch { return `id_${Date.now()}_${Math.random().toString(16).slice(2)}`; }
  };

  const nowISO = () => new Date().toISOString();

  const escapeHtml = (s) =>
    String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");

  /* ------------------------------
     State
  -------------------------------- */
  function defaultState() {
    return {
      version: VERSION,
      ui: {
        mode: "SIMPLE", // SIMPLE | PRO
        shopEditingId: null,
        lastVerifySuggestion: null,
        simple: { priceMode: "EXCL", defaultRate: TAX.R10 }
      },
      shops: [],
      selectedShopId: null,
      cart: [],
      cartSettings: {
        totalDiscount: { type: "NONE", value: 0, target: "BASE" } // PRO only
      },
      history: []
    };
  }

  function loadState() {
    const read = (k) => {
      try {
        const raw = localStorage.getItem(k);
        if (!raw) return null;
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };

    // v1 key
    const s1 = read(STORAGE_KEY);
    if (s1) return normalizeState(s1);

    // legacy
    for (const k of LEGACY_KEYS) {
      const s = read(k);
      if (s) return normalizeState(migrateLegacyToV1(s));
    }

    return defaultState();
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function migrateLegacyToV1(old) {
    // なるべく壊さない移行：旧stateの形が違っても拾えるものは拾う
    const base = defaultState();

    // UI
    base.ui.mode = old?.ui?.mode === "PRO" ? "PRO" : "SIMPLE";
    base.ui.simple = old?.ui?.simple || base.ui.simple;

    // Shops
    if (Array.isArray(old?.shops)) base.shops = old.shops.map(normalizeShop).filter(Boolean);

    // selected
    base.selectedShopId = old?.selectedShopId || (base.shops[0]?.id ?? null);

    // cart
    if (Array.isArray(old?.cart)) base.cart = old.cart.map(normalizeItem).filter(Boolean);

    // settings
    if (old?.cartSettings?.totalDiscount) base.cartSettings.totalDiscount = normalizeTotalDiscount(old.cartSettings.totalDiscount);

    // history
    if (Array.isArray(old?.history)) {
      base.history = old.history.map((h) => ({
        id: h?.id || uuid(),
        at: h?.at || Date.now(),
        shopSnapshot: h?.shopSnapshot ? normalizeShop(h.shopSnapshot) : null,
        itemsSnapshot: Array.isArray(h?.itemsSnapshot) ? h.itemsSnapshot.map(normalizeItem).filter(Boolean) : [],
        cartSettingsSnapshot: h?.cartSettingsSnapshot ? { totalDiscount: normalizeTotalDiscount(h.cartSettingsSnapshot.totalDiscount) } : { totalDiscount: normalizeTotalDiscount(base.cartSettings.totalDiscount) },
        result: h?.result || null
      }));
    }

    return base;
  }

  function normalizeState(s) {
    const d = defaultState();

    const out = {
      ...d,
      ...s,
      ui: { ...d.ui, ...(s.ui || {}) },
      cartSettings: { ...d.cartSettings, ...(s.cartSettings || {}) }
    };

    out.ui.mode = (out.ui.mode === "PRO") ? "PRO" : "SIMPLE";
    out.ui.simple = { ...d.ui.simple, ...(out.ui.simple || {}) };
    out.ui.simple.priceMode = (out.ui.simple.priceMode === "INCL") ? "INCL" : "EXCL";
    out.ui.simple.defaultRate = (out.ui.simple.defaultRate === TAX.R8) ? TAX.R8 : TAX.R10;

    out.shops = Array.isArray(out.shops) ? out.shops.map(normalizeShop).filter(Boolean) : [];
    out.cart = Array.isArray(out.cart) ? out.cart.map(normalizeItem).filter(Boolean) : [];
    out.history = Array.isArray(out.history) ? out.history : [];

    out.cartSettings.totalDiscount = normalizeTotalDiscount(out.cartSettings.totalDiscount);

    if (!out.selectedShopId || !out.shops.some(x => x.id === out.selectedShopId)) {
      out.selectedShopId = out.shops[0]?.id ?? null;
    }

    return out;
  }

  function normalizeTotalDiscount(td) {
    const d = { type: "NONE", value: 0, target: "BASE" };
    const t = td || {};
    const type = (t.type === "PERCENT" || t.type === "YEN") ? t.type : "NONE";
    const target = (t.target === "TOTAL") ? "TOTAL" : "BASE";
    return { type, value: safeNum(t.value, 0), target };
  }

  function defaultPolicyForPreset(preset) {
    // レジ方式：商品ごとに税計算、切り捨て、1円単位
    if (preset === "PRESET_ITEM_ROUND") {
      return { aggregation: "ITEM_ROUND", roundingMethod: "FLOOR", roundingUnit: 1, inclToBaseRounding: "NONE" };
    }
    // まとめ方式：税率ごとに合計、四捨五入、1円単位
    if (preset === "PRESET_RATE_GROUP") {
      return { aggregation: "RATE_GROUP_ROUND", roundingMethod: "ROUND", roundingUnit: 1, inclToBaseRounding: "NONE" };
    }
    return { aggregation: "ITEM_ROUND", roundingMethod: "ROUND", roundingUnit: 1, inclToBaseRounding: "NONE" };
  }

  function normalizeShop(s) {
    if (!s) return null;
    const id = String(s.id || uuid());
    const name = String(s.name || "（店名なし）");
    const memo = String(s.memo || "");
    const preset = (s.preset === "PRESET_RATE_GROUP" || s.preset === "PRESET_ITEM_ROUND") ? s.preset : "CUSTOM";

    // rates
    let ratesEnabled = Array.isArray(s.ratesEnabled) ? s.ratesEnabled : [TAX.R8, TAX.R10];
    ratesEnabled = ratesEnabled.filter(r => r === TAX.R8 || r === TAX.R10);
    if (ratesEnabled.length === 0) ratesEnabled = [TAX.R10];

    // policy
    const p0 = s.policy || defaultPolicyForPreset(preset);
    const aggregation = (p0.aggregation === "RATE_GROUP_ROUND") ? "RATE_GROUP_ROUND" : "ITEM_ROUND";
    const roundingMethod = (p0.roundingMethod === "FLOOR" || p0.roundingMethod === "CEIL") ? p0.roundingMethod : "ROUND";
    const roundingUnit = ([1, 10, 100].includes(Number(p0.roundingUnit))) ? Number(p0.roundingUnit) : 1;
    const inclToBaseRounding = (p0.inclToBaseRounding === "FLOOR" || p0.inclToBaseRounding === "CEIL" || p0.inclToBaseRounding === "ROUND") ? p0.inclToBaseRounding : "NONE";

    return {
      id,
      name,
      memo,
      preset,
      ratesEnabled,
      policy: { aggregation, roundingMethod, roundingUnit, inclToBaseRounding },
      createdAt: s.createdAt || nowISO(),
      updatedAt: s.updatedAt || nowISO()
    };
  }

  function normalizeItem(it) {
    if (!it) return null;
    const id = String(it.id || uuid());
    const name = String(it.name || "");
    const price = (it.price ?? ""); // 入力中の文字列を保持（計算時にsafeNumする）
    const qty = (it.qty ?? 1);
    const rate = (Number(it.rate) === TAX.R8) ? TAX.R8 : TAX.R10;
    const priceMode = (it.priceMode === "INCL") ? "INCL" : "EXCL";

    // PRO fields
    const discountType = (it.discountType === "PERCENT" || it.discountType === "YEN") ? it.discountType : "NONE";
    const discountValue = (it.discountValue ?? 0);

    return { id, name, price, qty, rate, priceMode, discountType, discountValue };
  }

  function defaultItem(rate) {
    return normalizeItem({
      id: uuid(),
      name: "",
      price: "",
      qty: 1,
      rate: rate ?? TAX.R10,
      priceMode: "EXCL",
      discountType: "NONE",
      discountValue: 0
    });
  }

  let state = loadState();

  /* ------------------------------
     Mode
  -------------------------------- */
  function isPro() { return state.ui.mode === "PRO"; }
  function isSimple() { return state.ui.mode === "SIMPLE"; }

  function applyModeToDom() {
    document.body.dataset.mode = state.ui.mode;
    $("modeToggle").textContent = `モード：${isSimple() ? "簡単" : "詳細"}`;
  }

  function normalizeForMode() {
    if (isSimple()) {
      // SIMPLEでは割引を無効化（状態は保存してもOKだけど、計算はNONEに寄せる）
      state.cartSettings.totalDiscount.type = "NONE";
      state.cartSettings.totalDiscount.value = 0;
      state.cartSettings.totalDiscount.target = "BASE";
      state.cart = state.cart.map(it => ({ ...it, discountType: "NONE", discountValue: 0 }));
    }
  }

  /* ------------------------------
     Sound (WebAudio synth)
  -------------------------------- */
  let soundPrefs = loadSoundPrefs();
  function loadSoundPrefs() {
    try {
      const raw = localStorage.getItem(SOUND_KEY);
      if (!raw) return { bgm: false, sfx: true, volume: 0.35 };
      const s = JSON.parse(raw);
      return {
        bgm: !!s.bgm,
        sfx: (s.sfx !== false),
        volume: clamp(Number(s.volume ?? 0.35), 0, 1)
      };
    } catch {
      return { bgm: false, sfx: true, volume: 0.35 };
    }
  }
  function saveSoundPrefs() {
    localStorage.setItem(SOUND_KEY, JSON.stringify(soundPrefs));
  }

  const audio = {
    ctx: null,
    master: null,
    bgmGain: null,
    sfxGain: null,
    isReady: false,
    isPlaying: false,
    timer: null,
    nodes: []
  };

  function ensureAudio() {
    if (audio.isReady) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;

    audio.ctx = new Ctx();
    audio.master = audio.ctx.createGain();
    audio.bgmGain = audio.ctx.createGain();
    audio.sfxGain = audio.ctx.createGain();

    audio.master.gain.value = soundPrefs.volume;
    audio.bgmGain.gain.value = 0.30;
    audio.sfxGain.gain.value = 0.90;

    audio.bgmGain.connect(audio.master);
    audio.sfxGain.connect(audio.master);
    audio.master.connect(audio.ctx.destination);

    audio.isReady = true;
  }

  function setMasterVolume(v01) {
    soundPrefs.volume = clamp(v01, 0, 1);
    saveSoundPrefs();
    if (audio.master) audio.master.gain.value = soundPrefs.volume;
  }

  function sfxClick() {
    if (!soundPrefs.sfx) return;
    ensureAudio();
    if (!audio.isReady) return;
    if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});

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

  function startBgm() {
    ensureAudio();
    if (!audio.isReady || audio.isPlaying) return;
    if (audio.ctx.state === "suspended") audio.ctx.resume().catch(() => {});

    const filter = audio.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 1200;
    filter.Q.value = 0.7;
    filter.connect(audio.bgmGain);

    const tempo = 78;
    const stepSec = (60 / tempo) * 2;

    const chords = [
      [220.00, 261.63, 329.63],
      [196.00, 246.94, 293.66],
      [174.61, 220.00, 261.63],
      [196.00, 246.94, 293.66]
    ];

    const playChord = (freqs, time) => {
      freqs.forEach((f, i) => {
        const o = audio.ctx.createOscillator();
        const g = audio.ctx.createGain();
        o.type = (i === 0) ? "sine" : "triangle";
        o.frequency.setValueAtTime(f, time);

        g.gain.setValueAtTime(0.0001, time);
        g.gain.exponentialRampToValueAtTime(0.10, time + 0.12);
        g.gain.exponentialRampToValueAtTime(0.0001, time + stepSec * 0.95);

        o.connect(g);
        g.connect(filter);
        o.start(time);
        o.stop(time + stepSec * 0.98);

        audio.nodes.push(o, g);
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
    };

    let idx = 0;
    audio.timer = setInterval(() => {
      const now = audio.ctx.currentTime;
      playChord(chords[idx % chords.length], now + 0.15);
      idx++;
    }, stepSec * 1000);

    audio.isPlaying = true;
  }

  function stopBgm() {
    if (audio.timer) clearInterval(audio.timer);
    audio.timer = null;

    audio.nodes.forEach(n => {
      try {
        if (n.stop) n.stop();
        if (n.disconnect) n.disconnect();
      } catch {}
    });
    audio.nodes = [];
    audio.isPlaying = false;
  }

  function syncSoundUI() {
    $("bgmToggle").textContent = `BGM：${soundPrefs.bgm ? "ON" : "OFF"}`;
    $("sfxToggle").textContent = `効果音：${soundPrefs.sfx ? "ON" : "OFF"}`;
    $("bgmVolume").value = String(Math.round(soundPrefs.volume * 100));
  }

  /* ------------------------------
     Calc
  -------------------------------- */
  function roundTo(value, method, unit = 1) {
    const u = Math.max(1, Number(unit) || 1);
    const x = value / u;
    let y = x;
    if (method === "FLOOR") y = Math.floor(x);
    else if (method === "CEIL") y = Math.ceil(x);
    else y = Math.round(x);
    return y * u;
  }

  function inclToBase(priceIncl, rate) {
    return priceIncl / (1 + rate);
  }

  function itemBaseBeforeDiscount(item, policy) {
    const rate = Number(item.rate);
    const qty = Math.max(1, safeInt(item.qty, 1));
    const price = Math.max(0, safeNum(item.price, 0));
    const mode = item.priceMode || "EXCL";

    let base = (mode === "INCL") ? inclToBase(price, rate) : price;

    // 税込→税抜の丸め
    const r = policy.inclToBaseRounding || "NONE";
    if (mode === "INCL" && r !== "NONE") {
      base = roundTo(base, r, 1);
    }

    return Math.max(0, base * qty);
  }

  function applyLineDiscount(base, item) {
    if (!isPro()) return base;

    const type = item.discountType || "NONE";
    const valueRaw = safeNum(item.discountValue, 0);

    if (type === "PERCENT") {
      const p = clamp(valueRaw, 0, 100);
      return Math.max(0, base * (1 - p / 100));
    }
    if (type === "YEN") {
      const y = Math.max(0, valueRaw);
      return Math.max(0, base - y);
    }
    return Math.max(0, base);
  }

  function applyTotalDiscountToBases(basesByItem, totalDiscount) {
    if (!isPro()) return basesByItem;

    const { type, value } = totalDiscount;
    const v = safeNum(value, 0);

    if (type === "PERCENT") {
      const p = clamp(v, 0, 100);
      const f = (1 - p / 100);
      return basesByItem.map(x => ({ ...x, base: Math.max(0, x.base * f) }));
    }

    if (type === "YEN") {
      let discount = Math.max(0, v);
      const totalBase = basesByItem.reduce((a, b) => a + b.base, 0);
      if (totalBase <= 0) return basesByItem;

      if (discount >= totalBase) {
        return basesByItem.map(x => ({ ...x, base: 0 }));
      }

      const out = basesByItem.map(x => ({ ...x }));
      let allocated = 0;

      for (let i = 0; i < out.length; i++) {
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

  function computeTotalsByPolicy(itemsWithBases, shop) {
    const p = shop.policy;
    const method = p.roundingMethod;
    const unit = Number(p.roundingUnit) || 1;
    const aggregation = p.aggregation;

    if (aggregation === "ITEM_ROUND") {
      let subtotal = 0;
      let total = 0;

      for (const it of itemsWithBases) {
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

    // RATE_GROUP_ROUND
    const byRate = new Map();
    for (const it of itemsWithBases) {
      const rate = Number(it.rate);
      byRate.set(rate, (byRate.get(rate) ?? 0) + Math.max(0, it.base));
    }

    let subtotal = 0;
    let total = 0;

    for (const [rate, baseSum] of byRate.entries()) {
      const baseRounded = roundTo(baseSum, method, unit);
      const totalRounded = roundTo(baseSum * (1 + rate), method, unit);
      subtotal += baseRounded;
      total += totalRounded;
    }

    const tax = Math.max(0, total - subtotal);
    return { subtotal, tax, total };
  }

  function policyNote(shop) {
    const p = shop.policy;
    const agg = (p.aggregation === "ITEM_ROUND") ? "商品ごとに丸めます。" : "税率ごとにまとめて丸めます。";
    const rm = (p.roundingMethod === "FLOOR") ? "切り捨てします。" : (p.roundingMethod === "CEIL") ? "切り上げします。" : "四捨五入します。";
    const unit = `${p.roundingUnit}円単位`;
    const incl = (p.inclToBaseRounding === "NONE") ? "丸めません。" :
      (p.inclToBaseRounding === "FLOOR") ? "切り捨てします。" :
      (p.inclToBaseRounding === "CEIL") ? "切り上げします。" : "四捨五入します。";
    return `計算方式：${agg}　端数：${rm}（${unit}）　税込→税抜：${incl}`;
  }

  function computeTransaction(shop, cart, cartSettings) {
    if (!shop) {
      return { ok: false, note: "店が未登録のため、計算できません。", subtotal: 0, tax: 0, totalBeforeDiscount: 0, discountAmount: 0, payTotal: 0 };
    }
    if (!cart || cart.length === 0) {
      return { ok: false, note: "商品が未入力です。", subtotal: 0, tax: 0, totalBeforeDiscount: 0, discountAmount: 0, payTotal: 0 };
    }

    // 店が許可していない税率は先頭税率に寄せる
    const enabledRates = new Set(shop.ratesEnabled);
    const normalized = cart.map(it => {
      const rate = Number(it.rate);
      const fixedRate = enabledRates.has(rate) ? rate : (shop.ratesEnabled[0] ?? TAX.R10);
      return { ...it, rate: fixedRate };
    });

    // 各商品：税抜ベース（数量込み）
    let basesByItem = normalized.map(it => {
      const base0 = itemBaseBeforeDiscount(it, shop.policy);
      const base1 = applyLineDiscount(base0, it);
      return { id: it.id, rate: Number(it.rate), base: base1, original: it };
    });

    // PRO：合計割引（税抜に適用する場合）
    const td = normalizeTotalDiscount(cartSettings?.totalDiscount);
    const totalsBefore = computeTotalsByPolicy(basesByItem, shop);

    let subtotal = totalsBefore.subtotal;
    let tax = totalsBefore.tax;
    let totalBeforeDiscount = totalsBefore.total;
    let discountAmount = 0;
    let payTotal = totalBeforeDiscount;
    let note = policyNote(shop);

    if (!isPro() || td.type === "NONE" || safeNum(td.value, 0) <= 0) {
      return { ok: true, note, subtotal, tax, totalBeforeDiscount, discountAmount: 0, payTotal: totalBeforeDiscount };
    }

    if (td.target === "BASE") {
      basesByItem = applyTotalDiscountToBases(basesByItem, td);
      const totalsAfter = computeTotalsByPolicy(basesByItem, shop);
      subtotal = totalsAfter.subtotal;
      tax = totalsAfter.tax;
      payTotal = totalsAfter.total;
      discountAmount = Math.max(0, totalBeforeDiscount - payTotal);
      note = policyNote(shop) + "　合計割引は、税抜合計に適用しています。";
      return { ok: true, note, subtotal, tax, totalBeforeDiscount, discountAmount, payTotal };
    }

    // TOTAL：税込に割引（税額は参考扱い）
    let t = totalBeforeDiscount;
    if (td.type === "PERCENT") {
      const p = clamp(safeNum(td.value, 0), 0, 100);
      t = Math.max(0, t * (1 - p / 100));
      t = roundTo(t, shop.policy.roundingMethod, 1);
    } else if (td.type === "YEN") {
      t = Math.max(0, t - Math.max(0, safeNum(td.value, 0)));
    }
    payTotal = Math.round(t);
    discountAmount = Math.max(0, totalBeforeDiscount - payTotal);
    note = policyNote(shop) + "　合計割引は、税込合計に適用しています。税額は参考値です。";
    return { ok: true, note, subtotal, tax, totalBeforeDiscount, discountAmount, payTotal };
  }

  /* ------------------------------
     UI: screens/tabs
  -------------------------------- */
  function setScreen(name) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("is-active"));
    const target = document.querySelector(`#screen-${name}`);
    if (target) target.classList.add("is-active");

    document.querySelectorAll(".tab").forEach(t => t.classList.remove("is-active"));
    const tab = document.querySelector(`.tab[data-screen="${name}"]`);
    if (tab) tab.classList.add("is-active");

    requestAnimationFrame(() => moveUnderline(tab));
  }

  function moveUnderline(tab) {
    const ul = document.querySelector(".tab-underline");
    const tabs = document.querySelector(".tabs");
    if (!ul || !tabs || !tab) return;
    const r1 = tabs.getBoundingClientRect();
    const r2 = tab.getBoundingClientRect();
    const x = r2.left - r1.left;
    ul.style.transform = `translateX(${x}px)`;
    ul.style.width = `${r2.width}px`;
  }

  /* ------------------------------
     UI: shop helpers
  -------------------------------- */
  function getSelectedShop() {
    return state.shops.find(s => s.id === state.selectedShopId) ?? null;
  }

  function renderShopSelect() {
    const sel = $("shopSelect");
    sel.innerHTML = "";

    if (state.shops.length === 0) {
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

    for (const shop of state.shops) {
      const opt = document.createElement("option");
      opt.value = shop.id;
      opt.textContent = shop.name;
      sel.appendChild(opt);
    }

    if (!state.selectedShopId || !state.shops.some(s => s.id === state.selectedShopId)) {
      state.selectedShopId = state.shops[0].id;
      saveState();
    }
    sel.value = state.selectedShopId;

    const shop = getSelectedShop();
    $("policySummary").textContent = policyNote(shop);
    $("shopMemoView").textContent = shop.memo ? `メモ：${shop.memo}` : "";
  }

  function applyPresetToForm(preset) {
    const p = defaultPolicyForPreset(preset);
    $("aggregation").value = p.aggregation === "RATE_GROUP_ROUND" ? "RATE_GROUP_ROUND" : "ITEM_ROUND";
    $("roundingMethod").value = p.roundingMethod;
    $("roundingUnit").value = String(p.roundingUnit);
    $("inclToBaseRounding").value = p.inclToBaseRounding;
  }

  function readShopForm() {
    const name = $("shopName").value.trim();
    const memo = $("shopMemo").value.trim();
    const rate8 = $("rate8").checked;
    const rate10 = $("rate10").checked;

    const ratesEnabled = [];
    if (rate8) ratesEnabled.push(TAX.R8);
    if (rate10) ratesEnabled.push(TAX.R10);
    if (ratesEnabled.length === 0) {
      ratesEnabled.push(TAX.R10);
      $("rate10").checked = true;
    }

    const preset = $("preset").value;
    const policy = {
      aggregation: $("aggregation").value,
      roundingMethod: $("roundingMethod").value,
      roundingUnit: Number($("roundingUnit").value) || 1,
      inclToBaseRounding: $("inclToBaseRounding").value
    };

    return { name, memo, ratesEnabled, preset, policy };
  }

  function writeShopForm(shop) {
    $("shopName").value = shop.name;
    $("shopMemo").value = shop.memo || "";
    $("rate8").checked = shop.ratesEnabled.includes(TAX.R8);
    $("rate10").checked = shop.ratesEnabled.includes(TAX.R10);

    $("preset").value = shop.preset || "CUSTOM";
    $("aggregation").value = shop.policy.aggregation;
    $("roundingMethod").value = shop.policy.roundingMethod;
    $("roundingUnit").value = String(shop.policy.roundingUnit ?? 1);
    $("inclToBaseRounding").value = shop.policy.inclToBaseRounding ?? "NONE";
  }

  function resetShopForm() {
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

  function renderShopList() {
    const wrap = $("shopList");
    wrap.innerHTML = "";

    if (state.shops.length === 0) {
      wrap.innerHTML = `<div class="muted">店が未登録です。上のフォームから登録してください。</div>`;
      return;
    }

    for (const shop of state.shops) {
      const div = document.createElement("div");
      div.className = "list-item";

      const ratesTxt = shop.ratesEnabled.map(r => `${Math.round(r * 100)}%`).join(" / ");
      const pTxt = policyNote(shop);

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
        renderCart(true); // 店が変わるとrateの選択肢も変わり得るので再描画
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
        if (state.selectedShopId === shop.id) {
          state.selectedShopId = state.shops[0]?.id ?? null;
        }
        saveState();
        renderShopSelect();
        renderShopList();
        renderCart(true);
        renderTotals();
      });

      wrap.appendChild(div);
    }
  }

  /* ------------------------------
     UI: simple bar
  -------------------------------- */
  function applySimpleBarUI() {
    const pmBtn = $("simplePriceModeToggle");
    const b8 = $("simpleDefaultRate8");
    const b10 = $("simpleDefaultRate10");

    if (pmBtn) pmBtn.textContent = `価格：${state.ui.simple.priceMode === "INCL" ? "税込" : "税抜"}`;

    const is8 = state.ui.simple.defaultRate === TAX.R8;
    if (b8) {
      b8.setAttribute("aria-pressed", is8 ? "true" : "false");
      b8.disabled = is8;
    }
    if (b10) {
      b10.setAttribute("aria-pressed", !is8 ? "true" : "false");
      b10.disabled = !is8;
    }
  }

  function applySimpleToAllItems() {
    if (!isSimple()) return;
    state.cart = state.cart.map(it => ({
      ...it,
      priceMode: state.ui.simple.priceMode,
      discountType: "NONE",
      discountValue: 0
    }));
  }

  /* ------------------------------
     UI: cart rendering (no rerender on typing)
  -------------------------------- */
  function renderCart(force = false) {
    const wrap = $("itemList");

    // force以外は「追加/削除/読み込み/店変更」などのタイミングでだけ呼ぶ想定
    // 入力(input)では呼ばない：1文字バグ防止
    wrap.innerHTML = "";

    const shop = getSelectedShop();
    const enabledRates = shop ? shop.ratesEnabled : [TAX.R10];

    if (state.cart.length === 0) {
      wrap.innerHTML = `<div class="muted">商品が未入力です。「商品追加」から入力してください。</div>`;
      return;
    }

    for (const item of state.cart) {
      const div = document.createElement("div");
      div.className = "item";
      div.dataset.itemId = item.id;

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
            <input data-k="name" value="${escapeHtml(item.name ?? "")}" placeholder="例：牛乳" />
          </label>

          <label class="field">
            <span>価格（円）</span>
            <input data-k="price" inputmode="numeric" value="${escapeHtml(String(item.price ?? ""))}" placeholder="0" />
          </label>

          <label class="field">
            <span>数量</span>
            <input data-k="qty" inputmode="numeric" value="${escapeHtml(String(item.qty ?? 1))}" placeholder="1" />
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

          <label class="field only-pro">
            <span>行割引</span>
            <select data-k="discountType">
              <option value="NONE">なし</option>
              <option value="PERCENT">％引き</option>
              <option value="YEN">円引き</option>
            </select>
          </label>
        </div>

        <div class="item-grid2 only-pro">
          <label class="field">
            <span>行割引の値</span>
            <input data-k="discountValue" inputmode="numeric" value="${escapeHtml(String(item.discountValue ?? ""))}" placeholder="例：5（％） または 100（円）" />
          </label>

          <div class="note">
            <div class="note-title">行割引の説明</div>
            <div class="note-body">行割引は、税抜金額（数量を反映した行合計）に対して適用します。</div>
          </div>
        </div>
      `;

      // セレクト初期値
      const priceModeSel = div.querySelector('select[data-k="priceMode"]');
      priceModeSel.value = item.priceMode || "EXCL";

      // 税率select
      const rateSel = div.querySelector('select[data-k="rate"]');
      rateSel.innerHTML = "";
      for (const r of [TAX.R8, TAX.R10]) {
        if (!enabledRates.includes(r)) continue;
        const opt = document.createElement("option");
        opt.value = String(r);
        opt.textContent = `${Math.round(r * 100)}%`;
        rateSel.appendChild(opt);
      }
      if (!enabledRates.includes(Number(item.rate))) {
        item.rate = enabledRates[0] ?? TAX.R10;
        saveState();
      }
      rateSel.value = String(item.rate);

      const discTypeSel = div.querySelector('select[data-k="discountType"]');
      if (discTypeSel) discTypeSel.value = item.discountType || "NONE";

      // ここが重要：inputでは再描画しない
      div.querySelectorAll("input").forEach((el) => {
        const k = el.dataset.k;
        if (!k) return;

        el.addEventListener("input", () => {
          const target = state.cart.find(c => c.id === item.id);
          if (!target) return;

          if (k === "name") {
            target.name = el.value;
            // タイトルはその場で更新（再描画不要）
            const t = target.name.trim() ? target.name.trim() : "（名称未入力）";
            const titleEl = div.querySelector(".item-title");
            if (titleEl) titleEl.textContent = t;
          }
          if (k === "price") {
            // 文字列を保持して入力を邪魔しない
            target.price = el.value;
          }
          if (k === "qty") {
            target.qty = el.value; // 文字列のまま保持し、計算時にsafeInt
          }
          if (k === "discountValue") {
            target.discountValue = el.value;
          }

          saveState();
          renderTotals(); // 合計だけ更新（フォーカス維持）
        });
      });

      // select(change)は再描画不要（合計更新だけ）
      div.querySelectorAll("select").forEach((el) => {
        const k = el.dataset.k;
        if (!k) return;

        el.addEventListener("change", () => {
          const target = state.cart.find(c => c.id === item.id);
          if (!target) return;

          if (k === "priceMode") target.priceMode = el.value;
          if (k === "rate") target.rate = Number(el.value);
          if (k === "discountType") target.discountType = el.value;

          saveState();
          renderTotals();
        });
      });

      // 削除は再描画
      div.querySelector(".icon-btn").addEventListener("click", () => {
        sfxClick();
        state.cart = state.cart.filter(c => c.id !== item.id);
        saveState();
        renderCart(true);
        renderTotals();
      });

      wrap.appendChild(div);
    }
  }

  /* ------------------------------
     UI: totals
  -------------------------------- */
  function syncDiscountUIFromState() {
    const td = normalizeTotalDiscount(state.cartSettings.totalDiscount);
    state.cartSettings.totalDiscount = td;

    if ($("totalDiscountType")) $("totalDiscountType").value = td.type;
    if ($("totalDiscountValue")) $("totalDiscountValue").value = td.value ? String(td.value) : "";
    if ($("totalDiscountTarget")) $("totalDiscountTarget").value = td.target;
  }

  function renderTotals() {
    const shop = getSelectedShop();

    if (isPro()) {
      const td = state.cartSettings.totalDiscount;
      td.type = $("totalDiscountType").value;
      td.value = safeNum($("totalDiscountValue").value, 0);
      td.target = $("totalDiscountTarget").value;
      state.cartSettings.totalDiscount = normalizeTotalDiscount(td);
    } else {
      state.cartSettings.totalDiscount = { type: "NONE", value: 0, target: "BASE" };
    }

    saveState();

    const res = computeTransaction(shop, state.cart, state.cartSettings);

    $("subtotal").textContent = yen(res.subtotal);
    $("tax").textContent = yen(res.tax);
    $("totalBefore").textContent = yen(res.totalBeforeDiscount);
    if ($("discount")) $("discount").textContent = yen(res.discountAmount);
    $("payTotal").textContent = yen(res.payTotal);
    $("calcNote").textContent = res.note;
  }

  /* ------------------------------
     History
  -------------------------------- */
  function renderHistory() {
    const wrap = $("historyList");
    wrap.innerHTML = "";

    if (state.history.length === 0) {
      wrap.innerHTML = `<div class="muted">履歴がありません。</div>`;
      return;
    }

    for (const h of [...state.history].reverse()) {
      const div = document.createElement("div");
      div.className = "list-item";

      const dt = new Date(h.at);
      const dtText = dt.toLocaleString("ja-JP");

      const shopName = h.shopSnapshot?.name ?? "（店情報なし）";
      const pay = h.result?.payTotal ?? 0;

      div.innerHTML = `
        <div class="list-top">
          <div>
            <strong>${escapeHtml(shopName)}</strong>
            <div class="list-meta">${escapeHtml(dtText)}</div>
          </div>
          <div style="text-align:right;">
            <div><strong>${yen(pay)}</strong></div>
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
        if (open) {
          detail.style.display = "none";
          return;
        }
        detail.style.display = "block";

        const lines = [];
        if (h.shopSnapshot) lines.push(`計算ルール：${policyNote(h.shopSnapshot)}`);
        lines.push("商品：");
        for (const it of (h.itemsSnapshot ?? [])) {
          const rate = `${Math.round(Number(it.rate) * 100)}%`;
          const mode = it.priceMode === "INCL" ? "税込" : "税抜";
          lines.push(`・${it.name || "（名称なし）"}：${safeNum(it.price, 0)}円（${mode}）×${safeInt(it.qty, 1)} / 税率：${rate}`);
        }
        detail.textContent = lines.join("\n");
      });

      div.querySelector('[data-act="load"]').addEventListener("click", () => {
        sfxClick();
        const snap = h.shopSnapshot;

        if (snap) {
          // 履歴に店スナップショットがある：存在しないなら復元して使う
          let shop = state.shops.find(s => s.id === snap.id);
          if (!shop) {
            shop = { ...normalizeShop(snap), id: uuid(), restoredFromHistory: true, createdAt: nowISO(), updatedAt: nowISO() };
            state.shops.push(shop);
          }
          state.selectedShopId = shop.id;
        }

        state.cart = (h.itemsSnapshot ?? []).map(x => ({ ...normalizeItem(x), id: uuid() }));
        state.cartSettings = h.cartSettingsSnapshot ?? state.cartSettings;

        normalizeForMode();
        saveState();

        renderShopSelect();
        syncDiscountUIFromState();
        renderCart(true);
        renderTotals();
        renderShopList();

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
     Verify (PRO only)
  -------------------------------- */
  function policyShort(p) {
    const ag = p.aggregation === "ITEM_ROUND" ? "商品ごと" : "税率ごと";
    const rm = p.roundingMethod === "FLOOR" ? "切り捨て" : p.roundingMethod === "CEIL" ? "切り上げ" : "四捨五入";
    const u = `${p.roundingUnit}円`;
    const ir = p.inclToBaseRounding === "NONE" ? "なし" :
      p.inclToBaseRounding === "FLOOR" ? "切り捨て" :
      p.inclToBaseRounding === "CEIL" ? "切り上げ" : "四捨五入";
    return `方式：${ag} / 端数：${rm}（${u}）/ 税込→税抜：${ir}`;
  }

  function suggestPoliciesForReceipt(shop, receiptTotal) {
    const receipt = safeInt(receiptTotal, -1);
    if (receipt < 0) return { matches: [], closest: [] };

    const aggregations = ["ITEM_ROUND", "RATE_GROUP_ROUND"];
    const methods = ["FLOOR", "ROUND", "CEIL"];
    const units = [1, 10, 100];
    const inclRounds = ["NONE", "FLOOR", "ROUND", "CEIL"];

    const candidates = [];

    for (const ag of aggregations) {
      for (const rm of methods) {
        for (const u of units) {
          for (const ir of inclRounds) {
            const tmpShop = {
              ...shop,
              policy: { ...shop.policy, aggregation: ag, roundingMethod: rm, roundingUnit: u, inclToBaseRounding: ir }
            };
            const res = computeTransaction(tmpShop, state.cart, state.cartSettings);
            const diff = Math.abs(res.payTotal - receipt);
            candidates.push({ policy: tmpShop.policy, payTotal: res.payTotal, diff });
          }
        }
      }
    }

    const matches = candidates.filter(c => c.diff === 0).slice(0, 8);
    const closest = candidates.sort((a, b) => a.diff - b.diff).slice(0, 8);
    return { matches, closest };
  }

  /* ------------------------------
     Export / Import
  -------------------------------- */
  function exportJson(filename, obj) {
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

  function normalizeImportedShop(s) {
    // importは「追加/置換」で使うのでidは新規にする（衝突回避）
    const shop = normalizeShop({ ...s, id: uuid() });
    shop.createdAt = nowISO();
    shop.updatedAt = nowISO();
    return shop;
  }

  function handleImportFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(String(reader.result || "{}"));
        if (!json || !Array.isArray(json.shops)) {
          alert("インポートできませんでした。ファイル形式を確認してください。");
          return;
        }

        const replace = confirm("インポートします。既存の店プロフィールを置き換えますか？\nOK：置き換え / キャンセル：追加");
        const incoming = json.shops.map(normalizeImportedShop).filter(Boolean);

        if (replace) {
          state.shops = incoming;
          state.selectedShopId = incoming[0]?.id ?? null;
        } else {
          state.shops.push(...incoming);
          if (!state.selectedShopId) state.selectedShopId = state.shops[0]?.id ?? null;
        }

        saveState();
        renderShopSelect();
        renderShopList();
        renderCart(true);
        renderTotals();
        alert("インポートしました。");
      } catch {
        alert("インポートできませんでした。ファイル内容を確認してください。");
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------
     Events
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
    renderCart(true); // 店が変わると税率の選択肢が変わる可能性がある
    renderTotals();
  });

  $("addItem").addEventListener("click", () => {
    sfxClick();
    const shop = getSelectedShop();
    const enabled = shop?.ratesEnabled ?? [TAX.R10];

    let rate = enabled[0] ?? TAX.R10;
    if (isSimple()) {
      const want = state.ui.simple.defaultRate ?? TAX.R10;
      rate = enabled.includes(want) ? want : (enabled[0] ?? TAX.R10);
    }

    const it = defaultItem(rate);

    if (isSimple()) {
      it.priceMode = state.ui.simple.priceMode;
      it.discountType = "NONE";
      it.discountValue = 0;
    }

    state.cart.push(it);
    saveState();
    renderCart(true);
    renderTotals();
  });

  $("clearCart").addEventListener("click", () => {
    sfxClick();
    if (!confirm("入力中の商品をすべて消去しますか？")) return;
    state.cart = [];
    saveState();
    renderCart(true);
    renderTotals();
  });

  // PRO割引UI
  $("totalDiscountType")?.addEventListener("change", () => { renderTotals(); });
  $("totalDiscountValue")?.addEventListener("input", () => { renderTotals(); });
  $("totalDiscountTarget")?.addEventListener("change", () => { renderTotals(); });

  // 履歴保存
  $("saveHistory").addEventListener("click", () => {
    sfxClick();
    const shop = getSelectedShop();
    if (!shop || state.cart.length === 0) {
      alert("店と商品を入力してから保存してください。");
      return;
    }

    const res = computeTransaction(shop, state.cart, state.cartSettings);

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
        payTotal: res.payTotal
      }
    };

    state.history.push(entry);
    saveState();
    renderHistory();
    alert("履歴に保存しました。");
  });

  // 店フォーム
  $("preset").addEventListener("change", () => {
    sfxClick();
    const preset = $("preset").value;
    if (preset !== "CUSTOM") applyPresetToForm(preset);
  });

  $("saveShop").addEventListener("click", () => {
    sfxClick();
    const form = readShopForm();
    if (!form.name) {
      alert("店名を入力してください。");
      return;
    }

    const ts = nowISO();
    const editingId = state.ui.shopEditingId;

    if (editingId) {
      const idx = state.shops.findIndex(s => s.id === editingId);
      if (idx >= 0) {
        state.shops[idx] = normalizeShop({
          ...state.shops[idx],
          name: form.name,
          memo: form.memo,
          ratesEnabled: form.ratesEnabled,
          preset: form.preset,
          policy: form.preset === "CUSTOM" ? form.policy : defaultPolicyForPreset(form.preset),
          updatedAt: ts
        });
      }
      state.ui.shopEditingId = null;
      $("cancelEdit").classList.add("is-hidden");
      $("saveShop").textContent = "登録";
      alert("更新しました。");
    } else {
      const shop = normalizeShop({
        id: uuid(),
        name: form.name,
        memo: form.memo,
        ratesEnabled: form.ratesEnabled,
        preset: form.preset,
        policy: form.preset === "CUSTOM" ? form.policy : defaultPolicyForPreset(form.preset),
        createdAt: ts,
        updatedAt: ts
      });
      state.shops.push(shop);
      if (!state.selectedShopId) state.selectedShopId = shop.id;
      alert("登録しました。");
    }

    saveState();
    renderShopSelect();
    renderShopList();
    renderCart(true);
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

    const demo1 = normalizeShop({
      id: uuid(),
      name: "例：商品ごと端数処理の店",
      memo: "商品ごとに税計算し、切り捨てします。",
      preset: "PRESET_ITEM_ROUND",
      policy: defaultPolicyForPreset("PRESET_ITEM_ROUND"),
      ratesEnabled: [TAX.R8, TAX.R10],
      createdAt: ts,
      updatedAt: ts
    });

    const demo2 = normalizeShop({
      id: uuid(),
      name: "例：税率ごと合計の店",
      memo: "税率ごとに合計してから、四捨五入します。",
      preset: "PRESET_RATE_GROUP",
      policy: defaultPolicyForPreset("PRESET_RATE_GROUP"),
      ratesEnabled: [TAX.R8, TAX.R10],
      createdAt: ts,
      updatedAt: ts
    });

    state.shops.push(demo1, demo2);
    if (!state.selectedShopId) state.selectedShopId = demo1.id;

    saveState();
    renderShopSelect();
    renderShopList();
    renderCart(true);
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
    renderCart(true);
    renderTotals();
  });

  $("deleteAllHistory").addEventListener("click", () => {
    sfxClick();
    if (!confirm("履歴を全削除しますか？")) return;
    state.history = [];
    saveState();
    renderHistory();
  });

  // Export/Import（PROのみ表示だが、イベントは貼ってOK）
  $("exportAll")?.addEventListener("click", () => {
    sfxClick();
    exportJson("MITTI_ShopHelper_Shops_v1.json", {
      kind: "MITTI_SHOPHELPER_EXPORT",
      version: VERSION,
      exportedAt: nowISO(),
      shops: state.shops
    });
  });

  $("importFile")?.addEventListener("change", (e) => {
    sfxClick();
    const file = e.target.files?.[0];
    if (!file) return;
    handleImportFile(file);
    e.target.value = "";
  });

  // Verify（PRO）
  $("runVerify")?.addEventListener("click", () => {
    sfxClick();
    if (!isPro()) return;

    const shop = getSelectedShop();
    if (!shop) { alert("店を登録してから検証してください。"); return; }
    if (state.cart.length === 0) { alert("商品を入力してから検証してください。"); return; }

    const receipt = safeInt($("receiptTotal").value, -1);
    if (receipt < 0) { alert("レシート合計を入力してください。"); return; }

    const current = computeTransaction(shop, state.cart, state.cartSettings);
    const diff = current.payTotal - receipt;

    const { matches, closest } = suggestPoliciesForReceipt(shop, receipt);

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
        return `(${i + 1}) ${policyShort(c.policy)} / 計算：${yen(c.payTotal)} / ${badge}`;
      }).join("\n");
      div.innerHTML = `<strong>${escapeHtml(title)}</strong><div class="list-meta">${escapeHtml(lines || "候補がありません。")}</div>`;
      box.appendChild(div);
    };

    if (matches.length > 0) {
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

  $("applySuggested")?.addEventListener("click", () => {
    sfxClick();
    if (!isPro()) return;

    const shop = getSelectedShop();
    const p = state.ui.lastVerifySuggestion;
    if (!shop || !p) { alert("適用できる候補がありません。"); return; }
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

  // Mode toggle
  $("modeToggle").addEventListener("click", () => {
    sfxClick();
    state.ui.mode = isSimple() ? "PRO" : "SIMPLE";
    normalizeForMode();
    saveState();

    applyModeToDom();
    syncDiscountUIFromState();
    applySimpleBarUI();

    renderTotals();
    // 画面は作り直さなくてOK（CSSで出し分け）
  });

  // Simple bar
  $("simplePriceModeToggle")?.addEventListener("click", () => {
    sfxClick();
    state.ui.simple.priceMode = (state.ui.simple.priceMode === "EXCL") ? "INCL" : "EXCL";
    applySimpleToAllItems();
    saveState();
    applySimpleBarUI();
    renderTotals();
    // 入力欄そのものは再描画しない（フォーカス維持）
  });

  $("simpleDefaultRate8")?.addEventListener("click", () => {
    sfxClick();
    state.ui.simple.defaultRate = TAX.R8;
    saveState();
    applySimpleBarUI();
  });

  $("simpleDefaultRate10")?.addEventListener("click", () => {
    sfxClick();
    state.ui.simple.defaultRate = TAX.R10;
    saveState();
    applySimpleBarUI();
  });

  // Sound UI
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
     Init
  -------------------------------- */
  function ensureMinimumData() {
    if (!Array.isArray(state.shops)) state.shops = [];
    if (!Array.isArray(state.cart)) state.cart = [];
    if (!Array.isArray(state.history)) state.history = [];

    // 最低1店が無い場合はヘルプへ誘導
    if (state.shops.length === 0) {
      // 初回は空のままでもOK
      return;
    }

    // cartが空なら1行入れる
    if (state.cart.length === 0) {
      const shop = getSelectedShop();
      const rate = shop?.ratesEnabled?.[0] ?? TAX.R10;
      const it = defaultItem(rate);
      if (isSimple()) it.priceMode = state.ui.simple.priceMode;
      state.cart.push(it);
    }
  }

  function init() {
    normalizeForMode();
    applyModeToDom();

    syncSoundUI();
    setMasterVolume(soundPrefs.volume);
    // 初回自動再生はしない
    if (soundPrefs.bgm) {
      soundPrefs.bgm = false;
      saveSoundPrefs();
      syncSoundUI();
    }

    ensureMinimumData();
    saveState();

    renderShopSelect();
    renderShopList();
    syncDiscountUIFromState();
    applySimpleBarUI();

    renderCart(true);
    renderTotals();
    renderHistory();

    requestAnimationFrame(() => {
      const tab = document.querySelector(".tab.is-active");
      moveUnderline(tab);
    });

    if (state.shops.length === 0) {
      setScreen("help");
    } else {
      setScreen("calc");
    }
  }

  init();
})();