/* MITTI ShopHelper v1.0.3
   - 税率 8/10
   - 店プロフィール（計算ルール + 丸め/roundTo + inclToBaseRounding）
   - 履歴（店ルールもスナップショット保存）
   - 簡単モード / 詳細モード
   - 割引（行/合計、%/円）
   - レシート検証（差分→丸め候補）
   - エクスポート/インポート
*/

(() => {
  "use strict";

  // ========= Utilities =========
  const yen = (n) => {
    const v = Number.isFinite(n) ? Math.round(n) : 0;
    return v.toLocaleString("ja-JP");
  };

  const nowStamp = () => {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const uid = () => Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);

  const clampTax = (t) => (t === 8 ? 8 : 10);

  const safeParseJSON = (s, fallback) => {
    try { return JSON.parse(s); } catch { return fallback; }
  };

  const debounce = (fn, ms = 200) => {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  // rounding
  const applyRounding = (value, mode = "round", roundTo = 1) => {
    const rt = Math.max(1, Number(roundTo) || 1);
    const scaled = value / rt;
    let r;
    if (mode === "floor") r = Math.floor(scaled);
    else if (mode === "ceil") r = Math.ceil(scaled);
    else r = Math.round(scaled);
    return r * rt;
  };

  // tax calc helpers
  const calcTaxFromBase = (base, taxRate, taxRounding = "round", roundTo = 1) => {
    const t = (base * taxRate) / 100;
    return applyRounding(t, taxRounding, roundTo);
  };

  const baseFromInclusive = (incl, taxRate, inclToBaseRounding = "round", roundTo = 1) => {
    const baseRaw = incl / (1 + taxRate / 100);
    return applyRounding(baseRaw, inclToBaseRounding, roundTo);
  };

  // ========= Storage =========
  const STORAGE_KEY = "mitti_shophelper_v1";
  const DEFAULT_STATE = {
    mode: "simple", // simple | advanced
    simpleTaxRate: 10,
    shops: [],
    currentShopId: null,
    cart: [],
    history: []
  };

  const loadState = () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_STATE);
    const st = safeParseJSON(raw, structuredClone(DEFAULT_STATE));
    // migrate/sanitize
    if (!Array.isArray(st.shops)) st.shops = [];
    if (!Array.isArray(st.cart)) st.cart = [];
    if (!Array.isArray(st.history)) st.history = [];
    if (st.mode !== "advanced") st.mode = "simple";
    st.simpleTaxRate = clampTax(st.simpleTaxRate);
    return st;
  };

  const saveStateUnsafe = (st) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(st));
  };

  let storageWarned = false;
  const saveState = (st) => {
    try {
      saveStateUnsafe(st);
    } catch (e) {
      if (!storageWarned) {
        storageWarned = true;
        alert("保存領域の都合でデータ保存に失敗しました。履歴が保存できない場合があります。不要な履歴を削除してから再度お試しください。");
      }
    }
  };
  const saveStateDebounced = debounce(saveState, 200);

  // ========= Defaults =========
  const defaultShops = () => ([
    {
      id: "shop-default",
      name: "（未設定）",
      preset: "item_tax_each",
      rounding: "round",
      roundTo: 1,
      taxRounding: "round",
      inclToBaseRounding: "round",
    }
  ]);

  const ensureAtLeastOneShop = (st) => {
    if (st.shops.length === 0) {
      st.shops = defaultShops();
      st.currentShopId = st.shops[0].id;
    } else if (!st.currentShopId || !st.shops.some(s => s.id === st.currentShopId)) {
      st.currentShopId = st.shops[0].id;
    }
  };

  const getCurrentShop = (st) => st.shops.find(s => s.id === st.currentShopId) || st.shops[0];

  const cloneShopSnapshot = (shop) => ({
    id: shop.id,
    name: shop.name,
    preset: shop.preset,
    rounding: shop.rounding,
    roundTo: shop.roundTo,
    taxRounding: shop.taxRounding,
    inclToBaseRounding: shop.inclToBaseRounding
  });

  // ========= State =========
  const state = loadState();
  ensureAtLeastOneShop(state);

  // ========= DOM =========
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const screens = {
    calc: $("#screen-calc"),
    shops: $("#screen-shops"),
    history: $("#screen-history"),
    help: $("#screen-help")
  };

  const tabButtons = $$(".tab");
  const underline = $(".tab-underline");

  const modePill = $("#modePill");
  const toggleModeBtn = $("#toggleModeBtn");
  const shopSelect = $("#shopSelect");
  const openShopBtn = $("#openShopBtn");

  const simpleBar = $("#simpleBar");
  const cartArea = $("#cartArea");
  const addItemBtn = $("#addItemBtn");
  const clearCartBtn = $("#clearCartBtn");
  const saveHistoryBtn = $("#saveHistoryBtn");

  const sumBase = $("#sumBase");
  const sumTax = $("#sumTax");
  const sumIncl = $("#sumIncl");

  const discountPanel = $("#discountPanel");
  const verifyPanel = $("#verifyPanel");

  // shops screen
  const shopsList = $("#shopsList");
  const newShopBtn = $("#newShopBtn");
  const deleteShopBtn = $("#deleteShopBtn");
  const exportShopsBtn = $("#exportShopsBtn");
  const importShopsInput = $("#importShopsInput");

  const shopName = $("#shopName");
  const shopPreset = $("#shopPreset");
  const shopRounding = $("#shopRounding");
  const shopRoundTo = $("#shopRoundTo");
  const shopTaxRounding = $("#shopTaxRounding");
  const shopInclToBase = $("#shopInclToBase");
  const saveShopBtn = $("#saveShopBtn");
  const setAsCurrentBtn = $("#setAsCurrentBtn");

  // history
  const historyList = $("#historyList");
  const clearHistoryBtn = $("#clearHistoryBtn");

  // ========= Tabs =========
  const showScreen = (id) => {
    $$(".screen").forEach(s => s.classList.remove("is-active"));
    tabButtons.forEach(t => t.classList.remove("is-active"));
    const screen = document.getElementById(id);
    if (screen) screen.classList.add("is-active");
    const btn = tabButtons.find(b => b.dataset.screen === id);
    if (btn) {
      btn.classList.add("is-active");
      btn.setAttribute("aria-current", "page");
      tabButtons.filter(b => b !== btn).forEach(b => b.removeAttribute("aria-current"));
      moveUnderline(btn);
    }
  };

  const moveUnderline = (btn) => {
    if (!btn || !underline) return;
    const rect = btn.getBoundingClientRect();
    const parentRect = btn.parentElement.getBoundingClientRect();
    underline.style.width = `${rect.width}px`;
    underline.style.transform = `translateX(${rect.left - parentRect.left}px)`;
  };

  tabButtons.forEach(btn => {
    btn.addEventListener("click", () => showScreen(btn.dataset.screen));
  });

  window.addEventListener("resize", () => {
    const active = tabButtons.find(t => t.classList.contains("is-active"));
    if (active) moveUnderline(active);
  });

  // ========= Mode =========
  const setMode = (m) => {
    state.mode = (m === "advanced") ? "advanced" : "simple";
    modePill.textContent = `モード：${state.mode === "advanced" ? "詳細" : "簡単"}`;
    saveStateDebounced(state);
    renderAll();
  };

  toggleModeBtn.addEventListener("click", () => {
    setMode(state.mode === "advanced" ? "simple" : "advanced");
  });

  // ========= Shops =========
  const renderShopSelects = () => {
    ensureAtLeastOneShop(state);
    const opts = state.shops.map(s => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    shopSelect.innerHTML = opts;
    shopsList.innerHTML = opts;
    shopSelect.value = state.currentShopId;
    shopsList.value = state.currentShopId;
  };

  shopSelect.addEventListener("change", () => {
    state.currentShopId = shopSelect.value;
    saveStateDebounced(state);
    renderAll();
  });

  openShopBtn.addEventListener("click", () => {
    showScreen("screen-shops");
    shopsList.value = state.currentShopId;
    loadShopForm(shopsList.value);
  });

  const loadShopForm = (shopId) => {
    const s = state.shops.find(x => x.id === shopId);
    if (!s) return;
    shopName.value = s.name || "";
    shopPreset.value = s.preset || "item_tax_each";
    shopRounding.value = s.rounding || "round";
    shopRoundTo.value = String(s.roundTo ?? 1);
    shopTaxRounding.value = s.taxRounding || "round";
    shopInclToBase.value = s.inclToBaseRounding || "round";
  };

  shopsList.addEventListener("change", () => {
    loadShopForm(shopsList.value);
  });

  newShopBtn.addEventListener("click", () => {
    const s = {
      id: `shop-${uid()}`,
      name: "新しい店",
      preset: "item_tax_each",
      rounding: "round",
      roundTo: 1,
      taxRounding: "round",
      inclToBaseRounding: "round",
    };
    state.shops.unshift(s);
    state.currentShopId = s.id;
    saveState(state);
    renderShopSelects();
    shopsList.value = s.id;
    loadShopForm(s.id);
  });

  deleteShopBtn.addEventListener("click", () => {
    if (state.shops.length <= 1) {
      alert("店は最低1つ必要です。");
      return;
    }
    const id = shopsList.value;
    const s = state.shops.find(x => x.id === id);
    if (!s) return;
    if (!confirm(`「${s.name}」を削除しますか？`)) return;

    state.shops = state.shops.filter(x => x.id !== id);
    if (!state.shops.some(x => x.id === state.currentShopId)) {
      state.currentShopId = state.shops[0].id;
    }
    saveState(state);
    renderAll();
  });

  saveShopBtn.addEventListener("click", () => {
    const id = shopsList.value;
    const s = state.shops.find(x => x.id === id);
    if (!s) return;
    s.name = shopName.value.trim() || "（無名の店）";
    s.preset = shopPreset.value;
    s.rounding = shopRounding.value;
    s.roundTo = Number(shopRoundTo.value) || 1;
    s.taxRounding = shopTaxRounding.value;
    s.inclToBaseRounding = shopInclToBase.value;
    saveState(state);
    renderAll();
  });

  setAsCurrentBtn.addEventListener("click", () => {
    state.currentShopId = shopsList.value;
    saveState(state);
    showScreen("screen-calc");
    renderAll();
  });

  exportShopsBtn.addEventListener("click", () => {
    const data = {
      version: "1.0.3",
      exportedAt: new Date().toISOString(),
      shops: state.shops
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "mitti_shops_export.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  importShopsInput.addEventListener("change", async () => {
    const file = importShopsInput.files && importShopsInput.files[0];
    if (!file) return;
    try {
      const txt = await file.text();
      const data = safeParseJSON(txt, null);
      if (!data || !Array.isArray(data.shops)) throw new Error("invalid");
      // minimal sanitize
      const imported = data.shops.map(s => ({
        id: s.id || `shop-${uid()}`,
        name: String(s.name || "（無名の店）"),
        preset: s.preset || "item_tax_each",
        rounding: s.rounding || "round",
        roundTo: Number(s.roundTo) || 1,
        taxRounding: s.taxRounding || "round",
        inclToBaseRounding: s.inclToBaseRounding || "round"
      }));
      if (imported.length === 0) throw new Error("empty");
      state.shops = imported;
      state.currentShopId = imported[0].id;
      saveState(state);
      renderAll();
      alert("インポートしました。");
    } catch (e) {
      alert("インポートに失敗しました。ファイル形式をご確認ください。");
    } finally {
      importShopsInput.value = "";
    }
  });

  // ========= Cart =========
  const newItem = () => ({
    id: `item-${uid()}`,
    name: "",
    priceStr: "",
    taxRate: state.mode === "simple" ? state.simpleTaxRate : 10,
    priceMode: "base", // base | incl (advanced)
    lineDiscount: { type: "none", value: 0 } // none | percent | yen
  });

  const ensureCartAtLeastOne = () => {
    if (state.cart.length === 0) state.cart.push(newItem());
  };

  addItemBtn.addEventListener("click", () => {
    state.cart.push(newItem());
    saveStateDebounced(state);
    renderCart();
    recalcTotals();
  });

  clearCartBtn.addEventListener("click", () => {
    if (!confirm("入力をクリアしますか？")) return;
    state.cart = [];
    ensureCartAtLeastOne();
    saveState(state);
    renderAll();
  });

  // simple tax buttons
  $$("#simpleBar .seg").forEach(btn => {
    btn.addEventListener("click", () => {
      const t = clampTax(Number(btn.dataset.simpleTax));
      state.simpleTaxRate = t;
      state.cart.forEach(it => { it.taxRate = t; });
      $$("#simpleBar .seg").forEach(b => b.classList.toggle("is-on", b === btn));
      saveStateDebounced(state);
      recalcTotals();
    });
  });

  // ========= Discounts (advanced) =========
  const defaultTotalDiscount = () => ({ enabled: false, target: "incl", type: "none", value: 0 });

  const ensureDiscountState = (st) => {
    if (!st.totalDiscount) st.totalDiscount = defaultTotalDiscount();
    if (!st.verify) st.verify = { receiptTotalStr: "" };
  };
  ensureDiscountState(state);

  const renderDiscountPanel = () => {
    if (state.mode !== "advanced") {
      discountPanel.innerHTML = "";
      return;
    }
    const d = state.totalDiscount || defaultTotalDiscount();
    discountPanel.innerHTML = `
      <div class="card" style="margin-top:12px;">
        <h2>割引・クーポン（合計）</h2>
        <div class="row wrap" style="margin-top:10px;">
          <label class="row" style="gap:8px;">
            <input id="tdEnabled" type="checkbox" ${d.enabled ? "checked" : ""}>
            <span class="muted">有効</span>
          </label>

          <select id="tdTarget" class="input" style="max-width:220px;">
            <option value="incl" ${d.target === "incl" ? "selected" : ""}>税込合計に適用</option>
            <option value="base" ${d.target === "base" ? "selected" : ""}>税抜合計に適用</option>
          </select>

          <select id="tdType" class="input" style="max-width:220px;">
            <option value="none" ${d.type === "none" ? "selected" : ""}>なし</option>
            <option value="percent" ${d.type === "percent" ? "selected" : ""}>%引き</option>
            <option value="yen" ${d.type === "yen" ? "selected" : ""}>円引き</option>
          </select>

          <input id="tdValue" class="input" style="max-width:220px;" inputmode="numeric" placeholder="値" value="${escapeHtml(String(d.value ?? ""))}">
        </div>
        <p class="muted" style="margin-top:10px; line-height:1.5;">
          合計割引は、計算の最後にまとめて適用します。割引後の端数処理は、店の丸め設定に従います。
        </p>
      </div>
    `;

    const enabled = $("#tdEnabled");
    const target = $("#tdTarget");
    const type = $("#tdType");
    const value = $("#tdValue");

    const sync = () => {
      state.totalDiscount.enabled = enabled.checked;
      state.totalDiscount.target = target.value;
      state.totalDiscount.type = type.value;
      state.totalDiscount.value = Number(value.value) || 0;
      saveStateDebounced(state);
      recalcTotals();
    };

    enabled.addEventListener("change", sync);
    target.addEventListener("change", sync);
    type.addEventListener("change", sync);
    value.addEventListener("input", sync);
  };

  // ========= Verify =========
  const renderVerifyPanel = () => {
    if (state.mode !== "advanced") {
      verifyPanel.innerHTML = "";
      return;
    }
    const v = state.verify || { receiptTotalStr: "" };
    verifyPanel.innerHTML = `
      <div class="card" style="margin-top:12px;">
        <h2>レシート検証</h2>
        <p class="muted" style="margin-top:8px; line-height:1.5;">
          レシートの「支払合計」を入力して、現在の設定で一致するか確認します。差分がある場合、丸め設定の候補を提示します。
        </p>
        <div class="row wrap" style="margin-top:10px;">
          <input id="receiptTotal" class="input" style="max-width:240px;" inputmode="numeric" placeholder="レシート合計（税込）" value="${escapeHtml(v.receiptTotalStr || "")}">
          <button id="runVerifyBtn" class="btn btn-primary" type="button">検証開始</button>
        </div>
        <div id="verifyResult" style="margin-top:10px;"></div>
      </div>
    `;

    $("#receiptTotal").addEventListener("input", (e) => {
      state.verify.receiptTotalStr = e.target.value;
      saveStateDebounced(state);
    });

    $("#runVerifyBtn").addEventListener("click", () => {
      runVerification();
    });
  };

  const runVerification = () => {
    const receipt = Number(state.verify.receiptTotalStr);
    const current = Number(sumIncl.dataset.raw || 0);
    const diff = receipt - current;

    const box = $("#verifyResult");
    if (!Number.isFinite(receipt) || receipt <= 0) {
      box.innerHTML = `<div class="note"><div class="note-title">入力をご確認ください</div><div class="note-body">レシート合計を数値で入力してください。</div></div>`;
      return;
    }

    if (Math.abs(diff) < 0.5) {
      box.innerHTML = `<div class="note" style="border-color: rgba(71,255,176,0.28);"><div class="note-title">一致しました</div><div class="note-body">現在の設定で、レシート合計と一致しています。</div></div>`;
      return;
    }

    // propose candidates by varying rounding modes / roundTo
    const shop = getCurrentShop(state);
    const candidates = [];

    const roundings = ["round", "floor", "ceil"];
    const roundTos = [1, 10, 100];

    for (const r of roundings) {
      for (const rt of roundTos) {
        const tmpShop = { ...shop, rounding: r, roundTo: rt };
        const totals = computeTotals(state, tmpShop);
        const d = receipt - totals.incl;
        candidates.push({ rounding: r, roundTo: rt, incl: totals.incl, diff: d });
      }
    }

    candidates.sort((a,b) => Math.abs(a.diff) - Math.abs(b.diff));
    const top = candidates.slice(0, 5);

    const fmt = (c) => {
      const label = `${roundingLabel(c.rounding)} / ${c.roundTo}円`;
      const diffStr = (c.diff > 0 ? `+${yen(c.diff)}` : `${yen(c.diff)}`);
      return `
        <div class="history-item">
          <div class="history-head">
            <div class="history-title">${label}</div>
            <div class="history-meta">差分：${diffStr} 円</div>
          </div>
          <div class="history-body">この設定の支払合計：<b>${yen(c.incl)}</b> 円</div>
          <div class="row wrap" style="margin-top:10px;">
            <button class="btn btn-secondary applyCandidateBtn" data-rounding="${c.rounding}" data-roundto="${c.roundTo}" type="button">候補を店に適用</button>
          </div>
        </div>
      `;
    };

    box.innerHTML = `
      <div class="note" style="border-color: rgba(255,85,122,0.26);">
        <div class="note-title">一致しませんでした</div>
        <div class="note-body">
          現在の計算：${yen(current)} 円 / レシート：${yen(receipt)} 円<br>
          差分：${diff > 0 ? "+" : ""}${yen(diff)} 円
        </div>
      </div>
      <div style="margin-top:10px;">
        ${top.map(fmt).join("")}
      </div>
    `;

    $$(".applyCandidateBtn").forEach(btn => {
      btn.addEventListener("click", () => {
        const rounding = btn.dataset.rounding;
        const roundTo = Number(btn.dataset.roundto) || 1;
        const s = getCurrentShop(state);
        s.rounding = rounding;
        s.roundTo = roundTo;
        saveState(state);
        renderAll();
        alert("候補を適用しました。再計算して一致するか確認してください。");
      });
    });
  };

  // ========= History =========
  const pushHistory = (entry) => {
    state.history.unshift(entry);
    // keep reasonable
    if (state.history.length > 200) state.history.length = 200;
  };

  saveHistoryBtn.addEventListener("click", () => {
    const shop = getCurrentShop(state);
    const totals = computeTotals(state, shop);
    const entry = {
      id: `hist-${uid()}`,
      at: nowStamp(),
      shopSnapshot: cloneShopSnapshot(shop),
      mode: state.mode,
      cart: structuredClone(state.cart),
      totalDiscount: structuredClone(state.totalDiscount || defaultTotalDiscount()),
      totals
    };
    pushHistory(entry);
    saveState(state);
    renderHistory();
    alert("履歴に保存しました。");
  });

  clearHistoryBtn.addEventListener("click", () => {
    if (!confirm("履歴を全削除しますか？")) return;
    state.history = [];
    saveState(state);
    renderHistory();
  });

  // ========= Rendering =========
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, m => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"
  }[m]));

  const roundingLabel = (m) => {
    if (m === "floor") return "切り捨て";
    if (m === "ceil") return "切り上げ";
    return "四捨五入";
  };

  const renderCart = () => {
    ensureCartAtLeastOne();

    const shop = getCurrentShop(state);
    const isAdv = state.mode === "advanced";
    simpleBar.style.display = isAdv ? "none" : "block";

    cartArea.innerHTML = state.cart.map((it, idx) => {
      const tax = clampTax(it.taxRate);
      const title = `商品 ${idx + 1}`;
      const lineDisc = it.lineDiscount || { type: "none", value: 0 };

      const advControls = isAdv ? `
        <div class="row wrap" style="margin-top:10px;">
          <span class="tag">税率</span>
          <button class="seg ${tax===10?"is-on":""}" data-act="setTax" data-id="${it.id}" data-tax="10" type="button">10%</button>
          <button class="seg ${tax===8?"is-on":""}" data-act="setTax" data-id="${it.id}" data-tax="8" type="button">8%</button>

          <span class="tag">価格</span>
          <button class="seg ${it.priceMode==="base"?"is-on":""}" data-act="setMode" data-id="${it.id}" data-mode="base" type="button">税抜</button>
          <button class="seg ${it.priceMode==="incl"?"is-on":""}" data-act="setMode" data-id="${it.id}" data-mode="incl" type="button">税込</button>
        </div>

        <div class="row wrap" style="margin-top:10px;">
          <span class="tag">行割引</span>
          <select class="input" style="max-width:180px;" data-act="lineDiscType" data-id="${it.id}">
            <option value="none" ${lineDisc.type==="none"?"selected":""}>なし</option>
            <option value="percent" ${lineDisc.type==="percent"?"selected":""}>%引き</option>
            <option value="yen" ${lineDisc.type==="yen"?"selected":""}>円引き</option>
          </select>
          <input class="input" style="max-width:180px;" inputmode="numeric" placeholder="値" value="${escapeHtml(String(lineDisc.value ?? ""))}" data-act="lineDiscValue" data-id="${it.id}">
        </div>
      ` : ``;

      return `
        <div class="item-card" data-item="${it.id}">
          <div class="item-top">
            <span class="tag">${title}</span>
            <input class="input" style="max-width:220px;" type="text" placeholder="名前（任意）" value="${escapeHtml(it.name || "")}" data-act="name" data-id="${it.id}">
            <input class="input" style="max-width:220px;" inputmode="numeric" placeholder="価格" value="${escapeHtml(it.priceStr || "")}" data-act="price" data-id="${it.id}">
            <div class="item-actions">
              <button class="btn btn-ghost" data-act="dup" data-id="${it.id}" type="button">複製</button>
              <button class="btn btn-danger" data-act="del" data-id="${it.id}" type="button">削除</button>
            </div>
          </div>
          ${advControls}
        </div>
      `;
    }).join("");

    // attach events (event delegation)
    cartArea.onclick = (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.act;
      const id = btn.dataset.id;
      if (!act || !id) return;

      const it = state.cart.find(x => x.id === id);
      if (!it) return;

      if (act === "del") {
        if (state.cart.length <= 1) {
          it.name = "";
          it.priceStr = "";
        } else {
          state.cart = state.cart.filter(x => x.id !== id);
        }
        saveStateDebounced(state);
        renderCart();
        recalcTotals();
      }

      if (act === "dup") {
        const copy = structuredClone(it);
        copy.id = `item-${uid()}`;
        state.cart.splice(state.cart.indexOf(it) + 1, 0, copy);
        saveStateDebounced(state);
        renderCart();
        recalcTotals();
      }

      if (act === "setTax") {
        const t = clampTax(Number(btn.dataset.tax));
        it.taxRate = t;
        saveStateDebounced(state);
        // small UI update: just re-render to update segs (safe for buttons)
        renderCart();
        recalcTotals();
      }

      if (act === "setMode") {
        const m = btn.dataset.mode === "incl" ? "incl" : "base";
        it.priceMode = m;
        saveStateDebounced(state);
        renderCart();
        recalcTotals();
      }
    };

    cartArea.onchange = (e) => {
      const el = e.target;
      const act = el.dataset.act;
      const id = el.dataset.id;
      if (!act || !id) return;
      const it = state.cart.find(x => x.id === id);
      if (!it) return;

      if (act === "lineDiscType") {
        it.lineDiscount = it.lineDiscount || { type:"none", value:0 };
        it.lineDiscount.type = el.value;
        saveStateDebounced(state);
        recalcTotals();
      }
    };

    // IMPORTANT: price input should not trigger full re-render each keypress
    cartArea.oninput = (e) => {
      const el = e.target;
      const act = el.dataset.act;
      const id = el.dataset.id;
      if (!act || !id) return;
      const it = state.cart.find(x => x.id === id);
      if (!it) return;

      if (act === "name") {
        it.name = el.value;
        saveStateDebounced(state);
        return;
      }

      if (act === "price") {
        it.priceStr = el.value;
        saveStateDebounced(state);
        recalcTotals(); // recalc only (no re-render)
        return;
      }

      if (act === "lineDiscValue") {
        it.lineDiscount = it.lineDiscount || { type:"none", value:0 };
        it.lineDiscount.value = Number(el.value) || 0;
        saveStateDebounced(state);
        recalcTotals();
        return;
      }
    };
  };

  const renderHistory = () => {
    if (!state.history || state.history.length === 0) {
      historyList.innerHTML = `<div class="muted">履歴はまだありません。</div>`;
      return;
    }

    historyList.innerHTML = state.history.map(h => {
      const totals = h.totals || { base:0, tax:0, incl:0 };
      const shop = h.shopSnapshot || { name:"（不明）" };
      return `
        <div class="history-item">
          <div class="history-head">
            <div class="history-title">${escapeHtml(shop.name)} / ${escapeHtml(h.at || "")}</div>
            <div class="history-meta">合計：${yen(totals.incl)} 円</div>
          </div>
          <div class="history-body">
            税抜：${yen(totals.base)} 円 / 税：${yen(totals.tax)} 円<br>
            モード：${h.mode === "advanced" ? "詳細" : "簡単"} / ルール：${presetLabel(shop.preset)}
          </div>
          <div class="row wrap" style="margin-top:10px;">
            <button class="btn btn-ghost" data-hact="restore" data-hid="${h.id}" type="button">この内容を復元</button>
            <button class="btn btn-danger" data-hact="delete" data-hid="${h.id}" type="button">削除</button>
          </div>
        </div>
      `;
    }).join("");

    historyList.onclick = (e) => {
      const btn = e.target.closest("button");
      if (!btn) return;
      const act = btn.dataset.hact;
      const hid = btn.dataset.hid;
      if (!act || !hid) return;

      const h = state.history.find(x => x.id === hid);
      if (!h) return;

      if (act === "delete") {
        if (!confirm("この履歴を削除しますか？")) return;
        state.history = state.history.filter(x => x.id !== hid);
        saveState(state);
        renderHistory();
      }

      if (act === "restore") {
        if (!confirm("この履歴の内容で入力を復元しますか？")) return;
        // restore cart + discount + shop (as current)
        state.cart = structuredClone(h.cart || []);
        ensureCartAtLeastOne();
        state.totalDiscount = structuredClone(h.totalDiscount || defaultTotalDiscount());
        setMode(h.mode === "advanced" ? "advanced" : "simple");
        // apply shop snapshot as a new shop entry? -> keep current shop, but user may want same rule:
        // We'll set current shop settings to snapshot (safe & practical)
        const s = getCurrentShop(state);
        if (h.shopSnapshot) {
          s.preset = h.shopSnapshot.preset;
          s.rounding = h.shopSnapshot.rounding;
          s.roundTo = h.shopSnapshot.roundTo;
          s.taxRounding = h.shopSnapshot.taxRounding;
          s.inclToBaseRounding = h.shopSnapshot.inclToBaseRounding;
        }
        saveState(state);
        showScreen("screen-calc");
        renderAll();
      }
    };
  };

  const presetLabel = (p) => {
    if (p === "sum_then_tax") return "税抜合計→税計算";
    if (p === "already_inclusive") return "入力は税込";
    return "商品ごと税→合計";
  };

  const computeTotals = (st, shop) => {
    const s = shop || getCurrentShop(st);
    const preset = s.preset || "item_tax_each";

    let baseTotal = 0;
    let taxTotal = 0;
    let inclTotal = 0;

    const items = st.cart || [];

    // helper to apply line discount
    const applyLineDiscount = (amount, disc) => {
      if (!disc || disc.type === "none") return amount;
      const v = Number(disc.value) || 0;
      if (disc.type === "percent") return Math.max(0, amount - (amount * v / 100));
      if (disc.type === "yen") return Math.max(0, amount - v);
      return amount;
    };

    if (preset === "already_inclusive") {
      // input treated as inclusive (tax included), per item taxRate still used for breakdown
      for (const it of items) {
        const taxRate = clampTax(it.taxRate);
        const incl = applyLineDiscount(Number(it.priceStr) || 0, it.lineDiscount);
        // derive base & tax using incl->base rounding
        const base = baseFromInclusive(incl, taxRate, s.inclToBaseRounding, s.roundTo);
        const tax = incl - base;
        baseTotal += base;
        taxTotal += tax;
        inclTotal += incl;
      }
      // final rounding on totals (shop rounding)
      baseTotal = applyRounding(baseTotal, s.rounding, s.roundTo);
      taxTotal = applyRounding(taxTotal, s.rounding, s.roundTo);
      inclTotal = applyRounding(inclTotal, s.rounding, s.roundTo);
    } else if (preset === "sum_then_tax") {
      // sum base then tax
      let sumBaseRaw = 0;
      for (const it of items) {
        const taxRate = clampTax(it.taxRate);
        const p = Number(it.priceStr) || 0;
        let base = p;

        if (st.mode === "advanced" && it.priceMode === "incl") {
          base = baseFromInclusive(p, taxRate, s.inclToBaseRounding, s.roundTo);
        }
        base = applyLineDiscount(base, it.lineDiscount);

        sumBaseRaw += base;
      }
      const baseRounded = applyRounding(sumBaseRaw, s.rounding, s.roundTo);
      const tax = calcTaxFromBase(baseRounded, st.mode === "advanced" ? 10 : st.simpleTaxRate, s.taxRounding, s.roundTo); // fallback: use selected in simple, else 10
      baseTotal = baseRounded;
      taxTotal = tax;
      inclTotal = baseTotal + taxTotal;
      inclTotal = applyRounding(inclTotal, s.rounding, s.roundTo);
    } else {
      // item_tax_each
      for (const it of items) {
        const taxRate = clampTax(it.taxRate);
        const p = Number(it.priceStr) || 0;

        let base = p;
        if (st.mode === "advanced" && it.priceMode === "incl") {
          base = baseFromInclusive(p, taxRate, s.inclToBaseRounding, s.roundTo);
        }

        base = applyLineDiscount(base, it.lineDiscount);
        base = applyRounding(base, s.rounding, s.roundTo);

        const tax = calcTaxFromBase(base, taxRate, s.taxRounding, s.roundTo);
        const incl = base + tax;

        baseTotal += base;
        taxTotal += tax;
        inclTotal += incl;
      }
      baseTotal = applyRounding(baseTotal, s.rounding, s.roundTo);
      taxTotal = applyRounding(taxTotal, s.rounding, s.roundTo);
      inclTotal = applyRounding(inclTotal, s.rounding, s.roundTo);
    }

    // apply total discount (advanced)
    if (st.mode === "advanced" && st.totalDiscount && st.totalDiscount.enabled) {
      const d = st.totalDiscount;
      const val = Number(d.value) || 0;

      const applyDisc = (amount) => {
        if (d.type === "percent") return Math.max(0, amount - (amount * val / 100));
        if (d.type === "yen") return Math.max(0, amount - val);
        return amount;
      };

      if (d.target === "base") {
        baseTotal = applyDisc(baseTotal);
        baseTotal = applyRounding(baseTotal, s.rounding, s.roundTo);
        taxTotal = calcTaxFromBase(baseTotal, 10, s.taxRounding, s.roundTo); // approximate: using 10 here because mixed is complex; practical
        inclTotal = applyRounding(baseTotal + taxTotal, s.rounding, s.roundTo);
      } else {
        inclTotal = applyDisc(inclTotal);
        inclTotal = applyRounding(inclTotal, s.rounding, s.roundTo);
        // breakdown
        baseTotal = applyRounding(baseTotal, s.rounding, s.roundTo);
        taxTotal = applyRounding(inclTotal - baseTotal, s.rounding, s.roundTo);
      }
    }

    return {
      base: Math.round(baseTotal),
      tax: Math.round(taxTotal),
      incl: Math.round(inclTotal),
    };
  };

  const recalcTotals = () => {
    const shop = getCurrentShop(state);
    const totals = computeTotals(state, shop);
    sumBase.textContent = yen(totals.base);
    sumTax.textContent = yen(totals.tax);
    sumIncl.textContent = yen(totals.incl);
    sumIncl.dataset.raw = String(totals.incl);
  };

  const renderAll = () => {
    renderShopSelects();
    loadShopForm(state.currentShopId);
    modePill.textContent = `モード：${state.mode === "advanced" ? "詳細" : "簡単"}`;
    // set simple bar segs
    $$("#simpleBar .seg").forEach(b => {
      b.classList.toggle("is-on", Number(b.dataset.simpleTax) === state.simpleTaxRate);
    });

    renderCart();
    renderDiscountPanel();
    renderVerifyPanel();
    recalcTotals();
    renderHistory();
  };

  // ========= Init =========
  ensureCartAtLeastOne();
  renderAll();
  // underline initial
  setTimeout(() => {
    const active = tabButtons.find(t => t.classList.contains("is-active"));
    if (active) moveUnderline(active);
  }, 20);

})();