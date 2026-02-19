/*
 * MITTI‑Helper Application Script
 *
 * This file contains all of the client-side logic for MITTI‑Helper. The app is a
 * single-page PWA that works offline and stores data locally via localStorage. It
 * includes store profile management, a purchase calculator with two taxation
 * methods, history and template management, a mini calculator, a numeric keypad,
 * sound support, dark/light themes, a tutorial, and offline detection. Functions
 * are organized into sections for clarity.
 */

(() => {
  // Data keys for localStorage
  const LS_KEYS = {
    stores: 'mitti_stores',
    currentStore: 'mitti_current_store',
    history: 'mitti_history',
    templates: 'mitti_templates',
    settings: 'mitti_settings',
    tutorial: 'mitti_tutorial_done'
  };

  // Application state
  let stores = [];
  let currentStoreId = null;
  let history = [];
  let templates = [];
  let settings = {
    theme: 'dark',
    bgm: true,
    sfx: true,
    bgmVolume: 0.5,
    sfxVolume: 0.5
  };
  let lastNumInput = null; // Last focused numeric input for calculator paste
  let audioEnabled = false; // Flag for user interaction enabling audio

  // Sound resources encoded as base64. These were generated via Python and are
  // inlined here. They represent small WAV files for BGM and sound effects.
  const SOUND_BASE64 = {
    // Main background music: use the same short beep sample as the sound effects.
    // Keeping the BGM audio small avoids excessively long code output. Users can replace this
    // base64 string with a longer melody if desired.
    bgm: `
UklGRmQmAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YWQmAAAAt1kCAOEr7wqMdCkhDYXXSi7unPMfn9cBtq/EqpcTgeKFaECYTLLIcq+a8GVasjUEn7iXMeTms9RzgcfC3Qw92ESiIUXGeYOHLwqwvztYDGDAGxb/CqT7c7NStyrHYmpQec3OQccp3pZfy7hUtwffqD8mZULngPH9uGjpXmNl5Lp10PpxSyQ==` ,
    // Short beep for add actions
    add: `
UklGRmQmAABXQVZFZm10 IBAAAAABAAEARKwAAIhYAQACABAAZGF0YWQmAAAAt1kCAOEr7wqMdCkhDYXXSi7unPMfn9cBtq/EqpcTgeKFaECYTLLIcq+a8GVasjUEn7iXMeTms9RzgcfC3Qw92ESiIUXGeYOHLwqwvztYDGDAGxb/CqT7c7NStyrHYmpQec3OQccp3pZfy7hUtwffqD8mZULngPH9uGjpXmNl5Lp10PpxSyQ==` ,
    // Short beep for delete actions (same sample reused for simplicity)
    del: `
UklGRmQmAABXQVZFZm10 IBAAAAABAAEARKwAAIhYAQACABAAZGF0YWQmAAAAt1kCAOEr7wqMdCkhDYXXSi7unPMfn9cBtq/EqpcTgeKFaECYTLLIcq+a8GVasjUEn7iXMeTms9RzgcfC3Qw92ESiIUXGeYOHLwqwvztYDGDAGxb/CqT7c7NStyrHYmpQec3OQccp3pZfy7hUtwffqD8mZULngPH9uGjpXmNl5Lp10PpxSyQ==`
  };

  // Audio objects
  let bgmAudio = null;
  let addAudio = null;
  let delAudio = null;

  // Utility: load base64 audio and create Audio objects
  function initAudio() {
    // Create audio objects if not already created
    if (!bgmAudio) {
      bgmAudio = new Audio('data:audio/wav;base64,' + SOUND_BASE64.bgm.trim());
      bgmAudio.loop = true;
      bgmAudio.volume = settings.bgmVolume;
    }
    if (!addAudio) {
      addAudio = new Audio('data:audio/wav;base64,' + SOUND_BASE64.add.trim());
      addAudio.volume = settings.sfxVolume;
    }
    if (!delAudio) {
      delAudio = new Audio('data:audio/wav;base64,' + SOUND_BASE64.del.trim());
      delAudio.volume = settings.sfxVolume;
    }
  }

  // Play sound effects safely
  function playSound(type) {
    if (!audioEnabled || !settings.sfx) return;
    if (type === 'add' && addAudio) {
      addAudio.currentTime = 0;
      addAudio.play();
    } else if (type === 'del' && delAudio) {
      delAudio.currentTime = 0;
      delAudio.play();
    }
  }

  // Play or stop BGM depending on settings
  function updateBGM() {
    if (!audioEnabled) return;
    if (settings.bgm) {
      if (bgmAudio && bgmAudio.paused) bgmAudio.play();
    } else {
      if (bgmAudio && !bgmAudio.paused) bgmAudio.pause();
    }
    if (bgmAudio) bgmAudio.volume = settings.bgmVolume;
  }

  // Persist settings to localStorage
  function saveSettings() {
    localStorage.setItem(LS_KEYS.settings, JSON.stringify(settings));
  }

  // Load settings from localStorage
  function loadSettings() {
    const s = localStorage.getItem(LS_KEYS.settings);
    if (s) {
      try {
        const parsed = JSON.parse(s);
        Object.assign(settings, parsed);
      } catch (e) { /* ignore invalid */ }
    }
    // Apply theme class
    document.body.classList.toggle('light', settings.theme === 'light');
  }

  // Initialize stores from localStorage or default
  function loadStores() {
    const stored = localStorage.getItem(LS_KEYS.stores);
    if (stored) {
      try { stores = JSON.parse(stored); } catch (e) {}
    }
    // If no stores exist, create defaults
    if (!stores || !stores.length) {
      stores = [
        { id: generateId(), name: '店A', memo: '例: 個別課税', method: 1 },
        { id: generateId(), name: '店B', memo: '例: 税率別合算', method: 2 }
      ];
      saveStores();
    }
    // Load current store selection
    const cs = localStorage.getItem(LS_KEYS.currentStore);
    if (cs && stores.some(s => s.id === cs)) {
      currentStoreId = cs;
    } else {
      currentStoreId = stores[0].id;
      localStorage.setItem(LS_KEYS.currentStore, currentStoreId);
    }
  }

  function saveStores() {
    localStorage.setItem(LS_KEYS.stores, JSON.stringify(stores));
  }

  // Load history
  function loadHistory() {
    const h = localStorage.getItem(LS_KEYS.history);
    if (h) {
      try { history = JSON.parse(h); } catch (e) {}
    }
  }
  function saveHistory() {
    localStorage.setItem(LS_KEYS.history, JSON.stringify(history));
  }
  // Load templates
  function loadTemplates() {
    const t = localStorage.getItem(LS_KEYS.templates);
    if (t) {
      try { templates = JSON.parse(t); } catch (e) {}
    }
  }
  function saveTemplates() {
    localStorage.setItem(LS_KEYS.templates, JSON.stringify(templates));
  }

  // Utility to generate unique IDs
  function generateId() {
    return 'id-' + Math.random().toString(36).substr(2, 9);
  }

  // Populate store dropdown and list
  function renderStores() {
    const select = document.getElementById('store-select');
    select.innerHTML = '';
    stores.forEach(store => {
      const option = document.createElement('option');
      option.value = store.id;
      option.textContent = store.name;
      select.appendChild(option);
    });
    select.value = currentStoreId;
    // List for editing
    const list = document.getElementById('store-list');
    list.innerHTML = '';
    stores.forEach(store => {
      const li = document.createElement('li');
      li.textContent = `${store.name} (${store.method === 1 ? '個別課税' : '税率別合算'})`;
      li.dataset.id = store.id;
      if (store.id === currentStoreId) li.classList.add('active');
      // Click to select store
      li.addEventListener('click', () => {
        currentStoreId = store.id;
        localStorage.setItem(LS_KEYS.currentStore, currentStoreId);
        renderStores();
        updateCalculation();
      });
      // Right side actions
      const actions = document.createElement('div');
      actions.style.position = 'absolute';
      actions.style.right = '5px';
      actions.style.top = '50%';
      actions.style.transform = 'translateY(-50%)';
      // Edit button
      const editBtn = document.createElement('button');
      editBtn.textContent = '編集';
      editBtn.className = 'secondary-button';
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        openStoreEditor(store);
      });
      // Delete button
      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.className = 'danger-button';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm('この店を削除しますか？')) {
          stores = stores.filter(s => s.id !== store.id);
          // If we removed current store, pick first remaining
          if (store.id === currentStoreId) {
            currentStoreId = stores.length ? stores[0].id : null;
            localStorage.setItem(LS_KEYS.currentStore, currentStoreId);
          }
          saveStores();
          renderStores();
          updateCalculation();
          playSound('del');
        }
      });
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  // Open store editor for create or edit
  function openStoreEditor(store) {
    const modal = document.getElementById('store-editor');
    modal.classList.remove('hidden');
    const title = document.getElementById('store-editor-title');
    const nameInput = document.getElementById('store-name');
    const memoInput = document.getElementById('store-memo');
    const methodSelect = document.getElementById('store-method');
    let editing = false;
    let editingId = null;
    if (store) {
      // editing existing
      editing = true;
      editingId = store.id;
      title.textContent = '店を編集';
      nameInput.value = store.name;
      memoInput.value = store.memo || '';
      methodSelect.value = store.method.toString();
    } else {
      // new store
      title.textContent = '店を追加';
      nameInput.value = '';
      memoInput.value = '';
      methodSelect.value = '1';
    }
    // Save button
    document.getElementById('store-save').onclick = () => {
      const name = nameInput.value.trim();
      if (!name) {
        alert('店名を入力してください');
        return;
      }
      const memo = memoInput.value.trim();
      const method = parseInt(methodSelect.value);
      if (editing) {
        // update
        const idx = stores.findIndex(s => s.id === editingId);
        if (idx >= 0) {
          stores[idx].name = name;
          stores[idx].memo = memo;
          stores[idx].method = method;
        }
      } else {
        // create new
        stores.push({ id: generateId(), name, memo, method });
      }
      saveStores();
      renderStores();
      modal.classList.add('hidden');
      playSound('add');
    };
    // Cancel button
    document.getElementById('store-cancel').onclick = () => {
      modal.classList.add('hidden');
    };
  }

  // Add product row to table
  function addProductRow(item = null) {
    const tbody = document.getElementById('product-body');
    const tr = document.createElement('tr');
    // Name
    const tdName = document.createElement('td');
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.placeholder = '商品名';
    nameInput.value = item && item.name ? item.name : '';
    tdName.appendChild(nameInput);
    // Price
    const tdPrice = document.createElement('td');
    const priceInput = document.createElement('input');
    priceInput.type = 'text';
    priceInput.readOnly = true;
    priceInput.dataset.num = 'price';
    priceInput.value = item && item.price ? item.price : '';
    priceInput.addEventListener('click', () => openNumKeypad(priceInput));
    tdPrice.appendChild(priceInput);
    // Quantity
    const tdQty = document.createElement('td');
    const qtyInput = document.createElement('input');
    qtyInput.type = 'text';
    qtyInput.readOnly = true;
    qtyInput.dataset.num = 'quantity';
    qtyInput.value = item && item.qty ? item.qty : '1';
    qtyInput.addEventListener('click', () => openNumKeypad(qtyInput));
    tdQty.appendChild(qtyInput);
    // Tax
    const tdTax = document.createElement('td');
    const taxSelect = document.createElement('select');
    [0,8,10].forEach(r => {
      const opt = document.createElement('option');
      opt.value = r;
      opt.textContent = `${r}%`;
      taxSelect.appendChild(opt);
    });
    taxSelect.value = item && item.tax !== undefined ? item.tax : 10;
    taxSelect.addEventListener('change', () => updateCalculation());
    tdTax.appendChild(taxSelect);
    // Discount
    const tdDisc = document.createElement('td');
    const discSelect = document.createElement('select');
    for (let d = 0; d <= 95; d += 5) {
      const opt = document.createElement('option');
      opt.value = d;
      opt.textContent = `${d}%`;
      discSelect.appendChild(opt);
    }
    discSelect.value = item && item.discount ? item.discount : 0;
    discSelect.addEventListener('change', () => updateCalculation());
    tdDisc.appendChild(discSelect);
    // Delete button
    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.className = 'danger-button';
    delBtn.textContent = '削除';
    delBtn.addEventListener('click', () => {
      tr.remove();
      updateCalculation();
      playSound('del');
    });
    tdDel.appendChild(delBtn);
    // Append to row
    tr.appendChild(tdName);
    tr.appendChild(tdPrice);
    tr.appendChild(tdQty);
    tr.appendChild(tdTax);
    tr.appendChild(tdDisc);
    tr.appendChild(tdDel);
    tbody.appendChild(tr);
  }

  // Gather products from table
  function getProducts() {
    const rows = document.querySelectorAll('#product-body tr');
    const items = [];
    rows.forEach(row => {
      const [nameEl, priceEl, qtyEl, taxEl, discEl] = row.querySelectorAll('td');
      const name = nameEl.querySelector('input').value.trim();
      const price = parseInt(priceEl.querySelector('input').value || '0');
      const qty = parseInt(qtyEl.querySelector('input').value || '0');
      const tax = parseInt(taxEl.querySelector('select').value);
      const discount = parseInt(discEl.querySelector('select').value);
      if (!isNaN(price) && !isNaN(qty) && qty > 0) {
        items.push({ name, price, qty, tax, discount });
      }
    });
    return items;
  }

  // Perform calculation based on current store method and items
  function calculate(items) {
    const store = stores.find(s => s.id === currentStoreId);
    const result = {
      items: [],
      baseTotal: 0,
      taxTotal: 0,
      grandTotal: 0,
      byRate: {} // {rate: {base, tax, total}}
    };
    // initialize byRate
    [0,8,10].forEach(rate => {
      result.byRate[rate] = { base: 0, tax: 0, total: 0 };
    });
    // compute per store method
    if (!store) return result;
    if (store.method === 1) {
      // individual taxation
      items.forEach(item => {
        const discountRate = item.discount / 100;
        // per unit discount price
        const discountedUnit = Math.floor(item.price * (1 - discountRate));
        // update base
        const baseSubTotal = discountedUnit * item.qty;
        // per unit tax
        const taxPerUnit = Math.floor(discountedUnit * item.tax / 100);
        const taxSubTotal = taxPerUnit * item.qty;
        result.baseTotal += baseSubTotal;
        result.taxTotal += taxSubTotal;
        const rateGroup = result.byRate[item.tax];
        rateGroup.base += baseSubTotal;
        rateGroup.tax += taxSubTotal;
        result.items.push({
          name: item.name,
          discountedUnit,
          baseSubTotal,
          taxPerUnit,
          taxSubTotal,
          taxRate: item.tax
        });
      });
    } else {
      // aggregated by tax rate
      items.forEach(item => {
        const discountRate = item.discount / 100;
        const discountedUnit = Math.floor(item.price * (1 - discountRate));
        const base = discountedUnit * item.qty;
        result.byRate[item.tax].base += base;
        result.items.push({
          name: item.name,
          discountedUnit,
          baseSubTotal: base,
          taxRate: item.tax
        });
      });
      // compute tax after summing base by rate
      Object.keys(result.byRate).forEach(key => {
        const rate = parseInt(key);
        const base = result.byRate[rate].base;
        const tax = Math.floor(base * rate / 100);
        result.byRate[rate].tax = tax;
      });
      // accumulate totals
      Object.values(result.byRate).forEach(obj => {
        result.baseTotal += obj.base;
        result.taxTotal += obj.tax;
      });
      // compute per-item tax totals (if we want to show per item tax, we can approximate, but not required)
      result.items.forEach(it => {
        it.taxSubTotal = Math.floor(result.byRate[it.tax].tax * it.baseSubTotal / result.byRate[it.tax].base || 0);
      });
    }
    result.grandTotal = result.baseTotal + result.taxTotal;
    // compute totals for each rate
    Object.keys(result.byRate).forEach(rate => {
      const grp = result.byRate[rate];
      grp.total = grp.base + grp.tax;
    });
    return result;
  }

  // Update calculation results UI
  function updateCalculation() {
    const items = getProducts();
    const res = calculate(items);
    // render results
    const div = document.getElementById('calc-results');
    div.innerHTML = '';
    const summary = document.createElement('div');
    summary.innerHTML = `<strong>税抜合計:</strong> ${res.baseTotal.toLocaleString()} 円<br>` +
      `<strong>税額:</strong> ${res.taxTotal.toLocaleString()} 円<br>` +
      `<strong>税込合計:</strong> ${res.grandTotal.toLocaleString()} 円`;
    div.appendChild(summary);
    // Details
    const details = document.createElement('details');
    const summaryEl = document.createElement('summary');
    summaryEl.textContent = '詳細';
    details.appendChild(summaryEl);
    // per rate breakdown
    const rateList = document.createElement('ul');
    Object.keys(res.byRate).forEach(rate => {
      const grp = res.byRate[rate];
      if (grp.base === 0 && grp.tax === 0) return;
      const li = document.createElement('li');
      li.textContent = `税率${rate}%: 税抜${grp.base.toLocaleString()}円 / 税額${grp.tax.toLocaleString()}円 / 税込${grp.total.toLocaleString()}円`;
      rateList.appendChild(li);
    });
    details.appendChild(rateList);
    // per item details
    const itemTable = document.createElement('table');
    const head = document.createElement('thead');
    head.innerHTML = '<tr><th>商品</th><th>割引後単価</th><th>割引後税抜小計</th><th>税率</th><th>税額小計</th></tr>';
    itemTable.appendChild(head);
    const body = document.createElement('tbody');
    res.items.forEach(it => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${it.name || ''}</td>` +
        `<td>${it.discountedUnit.toLocaleString()}</td>` +
        `<td>${it.baseSubTotal.toLocaleString()}</td>` +
        `<td>${it.taxRate}%</td>` +
        `<td>${(it.taxSubTotal || 0).toLocaleString()}</td>`;
      body.appendChild(tr);
    });
    itemTable.appendChild(body);
    details.appendChild(itemTable);
    div.appendChild(details);
    // voucher suggestion
    updateVoucherSuggestion(res.grandTotal);
  }

  // Compute voucher suggestion based on current total and target
  function updateVoucherSuggestion(currentTotal) {
    const targetInput = document.getElementById('target-amount');
    const voucherDiv = document.getElementById('voucher-suggestion');
    const target = parseInt(targetInput.value || '0');
    if (isNaN(target) || target <= 0) {
      voucherDiv.textContent = '';
      return;
    }
    const diff = target - currentTotal;
    if (diff <= 0) {
      voucherDiv.textContent = `目標を ${Math.abs(diff).toLocaleString()} 円超えています。`;
      return;
    }
    // compute minimal pre-tax amount for each rate to reach diff
    let html = '<strong>不足額:</strong> ' + diff.toLocaleString() + ' 円<br>追加購入目安:<ul>';
    [0,8,10].forEach(rate => {
      let x;
      if (rate === 0) {
        x = diff;
      } else {
        x = Math.ceil(diff * 100 / (100 + rate));
      }
      html += `<li>税率${rate}%: 税抜 ${x.toLocaleString()} 円</li>`;
    });
    html += '</ul>';
    voucherDiv.innerHTML = html;
  }

  // Save current calculation to history
  function saveCurrentToHistory() {
    const items = getProducts();
    if (!items.length) {
      alert('商品を入力してください');
      return;
    }
    const res = calculate(items);
    const store = stores.find(s => s.id === currentStoreId);
    const entry = {
      id: generateId(),
      timestamp: Date.now(),
      storeSnapshot: { ...store },
      result: res,
      items: items
    };
    history.unshift(entry);
    saveHistory();
    renderHistory();
    playSound('add');
    alert('履歴に保存しました');
  }

  // Render history list
  function renderHistory() {
    const container = document.getElementById('history-list');
    container.innerHTML = '';
    if (!history.length) {
      container.textContent = '履歴はありません';
      return;
    }
    history.forEach(entry => {
      const card = document.createElement('div');
      card.className = 'history-card';
      const date = new Date(entry.timestamp);
      card.innerHTML = `<strong>${entry.storeSnapshot.name}</strong><br>` +
        `${date.toLocaleString()}<br>` +
        `税込合計: ${entry.result.grandTotal.toLocaleString()} 円`;
      // Expand details
      const detailBtn = document.createElement('button');
      detailBtn.textContent = '詳細';
      detailBtn.className = 'secondary-button';
      const detailDiv = document.createElement('div');
      detailDiv.classList.add('hidden');
      detailDiv.style.marginTop = '0.5rem';
      detailBtn.addEventListener('click', () => {
        detailDiv.classList.toggle('hidden');
      });
      // fill detailDiv with table similar to result
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>商品</th><th>単価</th><th>数量</th><th>税率</th><th>割引</th></tr></thead>';
      const tbody = document.createElement('tbody');
      entry.items.forEach(it => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${it.name || ''}</td><td>${it.price.toLocaleString()}</td><td>${it.qty}</td><td>${it.tax}%</td><td>${it.discount}%</td>`;
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      detailDiv.appendChild(table);
      // Save to template button
      const tmplBtn = document.createElement('button');
      tmplBtn.textContent = 'テンプレ化';
      tmplBtn.className = 'secondary-button';
      tmplBtn.addEventListener('click', () => {
        const name = prompt('テンプレ名を入力してください', entry.storeSnapshot.name + ' ' + date.toLocaleDateString());
        if (name) {
          const tmpl = {
            id: generateId(),
            name,
            storeSnapshot: entry.storeSnapshot,
            items: entry.items
          };
          templates.push(tmpl);
          saveTemplates();
          renderTemplates();
          playSound('add');
        }
      });
      detailDiv.appendChild(tmplBtn);
      card.appendChild(detailBtn);
      card.appendChild(detailDiv);
      // Action buttons
      const actionWrap = document.createElement('div');
      actionWrap.style.marginTop = '0.5rem';
      // Load button
      const loadBtn = document.createElement('button');
      loadBtn.textContent = '読み込む';
      loadBtn.className = 'primary-button';
      loadBtn.addEventListener('click', () => {
        loadHistoryEntry(entry);
        playSound('add');
      });
      // Delete button
      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.className = 'danger-button';
      delBtn.addEventListener('click', () => {
        if (confirm('この履歴を削除しますか？')) {
          history = history.filter(h => h.id !== entry.id);
          saveHistory();
          renderHistory();
          playSound('del');
        }
      });
      actionWrap.appendChild(loadBtn);
      actionWrap.appendChild(delBtn);
      card.appendChild(actionWrap);
      container.appendChild(card);
    });
  }

  // Load a history entry into calculation tab
  function loadHistoryEntry(entry) {
    // set current store to snapshot
    const snapshot = entry.storeSnapshot;
    // If the snapshot store id exists, select it; otherwise add to stores list
    const existing = stores.find(s => s.name === snapshot.name && s.method === snapshot.method);
    if (!existing) {
      stores.push({ id: generateId(), name: snapshot.name, memo: snapshot.memo, method: snapshot.method });
      saveStores();
    }
    // Set current store by name matching; else first
    const targetStore = stores.find(s => s.name === snapshot.name && s.method === snapshot.method) || stores[0];
    currentStoreId = targetStore.id;
    localStorage.setItem(LS_KEYS.currentStore, currentStoreId);
    renderStores();
    // clear current products and insert items
    const tbody = document.getElementById('product-body');
    tbody.innerHTML = '';
    entry.items.forEach(it => addProductRow({ name: it.name, price: it.price, qty: it.qty, tax: it.tax, discount: it.discount }));
    // switch to calc tab
    switchTab('calc-tab');
    updateCalculation();
  }

  // Render templates list
  function renderTemplates() {
    const container = document.getElementById('template-list');
    container.innerHTML = '';
    if (!templates.length) {
      container.textContent = 'テンプレはありません';
      return;
    }
    templates.forEach((tmpl, idx) => {
      const card = document.createElement('div');
      card.className = 'template-card';
      card.draggable = true;
      card.dataset.index = idx;
      card.innerHTML = `<strong>${tmpl.name}</strong><br>${tmpl.items.length} 商品`;
      // Rename button
      const renameBtn = document.createElement('button');
      renameBtn.textContent = '名前変更';
      renameBtn.className = 'secondary-button';
      renameBtn.addEventListener('click', () => {
        const newName = prompt('新しい名前を入力してください', tmpl.name);
        if (newName) {
          tmpl.name = newName;
          saveTemplates();
          renderTemplates();
        }
      });
      // Use button
      const useBtn = document.createElement('button');
      useBtn.textContent = '使用';
      useBtn.className = 'primary-button';
      useBtn.addEventListener('click', () => {
        loadTemplate(tmpl);
        playSound('add');
      });
      // Delete button
      const delBtn = document.createElement('button');
      delBtn.textContent = '削除';
      delBtn.className = 'danger-button';
      delBtn.addEventListener('click', () => {
        if (confirm('このテンプレを削除しますか？')) {
          templates = templates.filter(t => t.id !== tmpl.id);
          saveTemplates();
          renderTemplates();
          playSound('del');
        }
      });
      // Append buttons
      card.appendChild(renameBtn);
      card.appendChild(useBtn);
      card.appendChild(delBtn);
      container.appendChild(card);
    });
    // Drag and drop reorder
    container.addEventListener('dragstart', (e) => {
      const idx = e.target.dataset.index;
      e.dataTransfer.setData('text/plain', idx);
    });
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const target = e.target.closest('.template-card');
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const offset = e.clientY - rect.top;
      target.style.borderTop = offset < rect.height / 2 ? '2px solid var(--accent-color)' : '';
      target.style.borderBottom = offset >= rect.height / 2 ? '2px solid var(--accent-color)' : '';
    });
    container.addEventListener('dragleave', (e) => {
      const target = e.target.closest('.template-card');
      if (target) {
      target.style.borderTop = '';
      target.style.borderBottom = '';
      }
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
      const targetCard = e.target.closest('.template-card');
      if (!targetCard) return;
      const toIdx = parseInt(targetCard.dataset.index);
      if (fromIdx === toIdx) return;
      // reorder array
      const [moved] = templates.splice(fromIdx, 1);
      templates.splice(toIdx, 0, moved);
      saveTemplates();
      renderTemplates();
    });
  }

  // Load a template into calculation
  function loadTemplate(tmpl) {
    // same as history load but using template's storeSnapshot and items
    // check if store exists else add
    const snapshot = tmpl.storeSnapshot;
    const existing = stores.find(s => s.name === snapshot.name && s.method === snapshot.method);
    if (!existing) {
      stores.push({ id: generateId(), name: snapshot.name, memo: snapshot.memo, method: snapshot.method });
      saveStores();
    }
    const targetStore = stores.find(s => s.name === snapshot.name && s.method === snapshot.method) || stores[0];
    currentStoreId = targetStore.id;
    localStorage.setItem(LS_KEYS.currentStore, currentStoreId);
    renderStores();
    // load items
    const tbody = document.getElementById('product-body');
    tbody.innerHTML = '';
    tmpl.items.forEach(it => addProductRow({ name: it.name, price: it.price, qty: it.qty, tax: it.tax, discount: it.discount }));
    switchTab('calc-tab');
    updateCalculation();
  }

  // Delete all history
  function deleteAllHistory() {
    if (!history.length) return;
    if (confirm('履歴を全削除しますか？')) {
      history = [];
      saveHistory();
      renderHistory();
      playSound('del');
    }
  }

  // Switch visible tab
  function switchTab(id) {
    document.querySelectorAll('.tab-content').forEach(sec => {
      sec.classList.toggle('hidden', sec.id !== id);
    });
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === id);
    });
  }

  // Numeric keypad logic
  function openNumKeypad(inputEl) {
    lastNumInput = inputEl;
    const modal = document.getElementById('num-keypad');
    const display = document.getElementById('num-display');
    display.value = inputEl.value || '';
    modal.classList.remove('hidden');
  }
  function closeNumKeypad(save) {
    const modal = document.getElementById('num-keypad');
    const display = document.getElementById('num-display');
    if (save && lastNumInput) {
      // remove leading zeros
      let val = display.value.replace(/^0+(\d)/, '$1');
      lastNumInput.value = val;
      updateCalculation();
    }
    modal.classList.add('hidden');
    lastNumInput = null;
  }
  function buildNumKeypad() {
    const buttonsDiv = document.querySelector('#num-keypad .num-buttons');
    // digits 1-9, 0, backspace
    const keys = ['7','8','9','4','5','6','1','2','3','0','←','C'];
    keys.forEach(key => {
      const btn = document.createElement('button');
      btn.textContent = key;
      btn.addEventListener('click', () => {
        const display = document.getElementById('num-display');
        if (key === '←') {
          display.value = display.value.slice(0, -1);
        } else if (key === 'C') {
          display.value = '';
        } else {
          display.value += key;
        }
      });
      buttonsDiv.appendChild(btn);
    });
    // OK/Cancel handlers
    document.getElementById('num-ok').addEventListener('click', () => closeNumKeypad(true));
    document.getElementById('num-cancel').addEventListener('click', () => closeNumKeypad(false));
  }

  // Mini calculator logic
  let calcExpression = '';
  function buildCalculator() {
    const btnContainer = document.querySelector('#calculator-panel .calc-buttons');
    const buttons = [
      '7','8','9','+',
      '4','5','6','-',
      '1','2','3','*',
      '0','C','=','/'
    ];
    buttons.forEach(key => {
      const btn = document.createElement('button');
      btn.textContent = key;
      btn.addEventListener('click', () => {
        if (key === 'C') {
          calcExpression = '';
          updateCalcDisplay();
        } else if (key === '=') {
          try {
            const result = eval(calcExpression || '0');
            calcExpression = Math.floor(result).toString();
          } catch (e) {
            calcExpression = '';
          }
          updateCalcDisplay();
        } else {
          calcExpression += key;
          updateCalcDisplay();
        }
      });
      btnContainer.appendChild(btn);
    });
    // Copy & close actions
    document.getElementById('calc-copy').addEventListener('click', () => {
      if (!lastNumInput) {
        alert('コピー先の入力欄を先に選択してください');
        return;
      }
      const value = calcExpression || '0';
      lastNumInput.value = value;
      updateCalculation();
    });
    document.getElementById('calc-close').addEventListener('click', () => {
      document.getElementById('calculator-panel').classList.add('hidden');
    });
    document.getElementById('calc-toggle').addEventListener('click', () => {
      const panel = document.getElementById('calculator-panel');
      panel.classList.toggle('hidden');
    });
  }
  function updateCalcDisplay() {
    document.getElementById('calc-display').value = calcExpression;
  }

  // Help content static HTML
  function populateHelp() {
    const container = document.querySelector('#help-tab .help-content');
    container.innerHTML = `
      <p>MITTI‑Helperは、買い物の計算を手助けするアプリです。以下の手順で使ってみましょう。</p>
      <h3>1. 店を選ぶ</h3>
      <p>まずは「計算」タブで計算方式が登録された店を選択します。計算方式には「個別課税方式」と「税率別合算方式」があります。店は「店」タブで追加・編集できます。</p>
      <h3>2. 商品を入力</h3>
      <p>商品の価格（税抜）、数量、税率、割引を入力します。価格や数量は専用テンキーで入力し、割引は0〜95％の範囲で5％刻みで選択できます。商品を追加するには「商品追加」を押します。</p>
      <h3>3. 結果を見る</h3>
      <p>入力した商品情報に基づき、税抜合計・税額・税込合計が自動計算されます。「詳細」を開くと税率ごとの小計や各商品の割引後の単価を確認できます。</p>
      <h3>4. 履歴を保存</h3>
      <p>計算結果は「結果を保存」ボタンで履歴に保存できます。保存された履歴は「履歴」タブから確認・再利用・削除ができます。</p>
      <h3>5. テンプレートを活用</h3>
      <p>よく買うセットはテンプレートとして保存できます。履歴からテンプレート化するか、テンプレートタブで管理できます。テンプレート名の変更や並び替え、削除、読み込みが行えます。</p>
      <h3>6. その他の機能</h3>
      <ul>
        <li><strong>商品券支払いサポート</strong>: 目標金額を入力すると、あといくら買えば良いかを税率別に表示します。</li>
        <li><strong>専用テンキー</strong>: 価格や数量など数字入力が必要な箇所はテンキーを利用します。</li>
        <li><strong>ミニ電卓</strong>: ちょっとした計算に使える電卓を画面右下から開閉できます。</li>
        <li><strong>ライト/ダークモード切替</strong>: 設定タブから外観を切り替えられます。</li>
        <li><strong>BGM・効果音</strong>: ON/OFFや音量調整が可能です。音を鳴らすには最初に画面をタップしてください。</li>
      </ul>
    `;
  }

  // Settings UI update
  function applySettingsToUI() {
    document.getElementById('bgm-toggle').checked = settings.bgm;
    document.getElementById('sfx-toggle').checked = settings.sfx;
    document.getElementById('bgm-volume').value = settings.bgmVolume;
    document.getElementById('sfx-volume').value = settings.sfxVolume;
    document.body.classList.toggle('light', settings.theme === 'light');
  }

  function setupSettingsHandlers() {
    // Theme toggle
    document.getElementById('theme-toggle').addEventListener('click', () => {
      settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
      saveSettings();
      applySettingsToUI();
    });
    // BGM toggle
    document.getElementById('bgm-toggle').addEventListener('change', (e) => {
      settings.bgm = e.target.checked;
      saveSettings();
      updateBGM();
    });
    // SFX toggle
    document.getElementById('sfx-toggle').addEventListener('change', (e) => {
      settings.sfx = e.target.checked;
      saveSettings();
    });
    // Volume sliders
    document.getElementById('bgm-volume').addEventListener('input', (e) => {
      settings.bgmVolume = parseFloat(e.target.value);
      saveSettings();
      if (bgmAudio) bgmAudio.volume = settings.bgmVolume;
    });
    document.getElementById('sfx-volume').addEventListener('input', (e) => {
      settings.sfxVolume = parseFloat(e.target.value);
      saveSettings();
      if (addAudio) addAudio.volume = settings.sfxVolume;
      if (delAudio) delAudio.volume = settings.sfxVolume;
    });
    // Clear data
    document.getElementById('clear-data').addEventListener('click', () => {
      if (confirm('全てのデータを初期化しますか？')) {
        localStorage.clear();
        location.reload();
      }
    });
  }

  // Tutorial slides
  const tutorialSlides = [
    {
      title: '店を選択',
      content: '計算タブで、計算方式を持つ店を選びます。店を追加・編集するには「店」タブを開いてください。'
    },
    {
      title: '商品追加',
      content: '商品名、価格、数量、税率、割引を入力します。数字の入力には専用のテンキーを利用します。'
    },
    {
      title: '履歴に保存',
      content: '計算結果を履歴に保存すると、後で再利用したりテンプレート化できます。'
    }
  ];
  let tutorialIndex = 0;
  function showTutorial() {
    const tut = document.getElementById('tutorial');
    const slideDiv = document.getElementById('tutorial-slide');
    const nextBtn = document.getElementById('tutorial-next');
    function renderSlide() {
      const slide = tutorialSlides[tutorialIndex];
      slideDiv.innerHTML = `<h3>${slide.title}</h3><p>${slide.content}</p>`;
      nextBtn.textContent = tutorialIndex < tutorialSlides.length - 1 ? '次へ' : '完了';
    }
    nextBtn.onclick = () => {
      if (tutorialIndex < tutorialSlides.length - 1) {
        tutorialIndex++;
        renderSlide();
      } else {
        // finish
        tut.classList.add('hidden');
        localStorage.setItem(LS_KEYS.tutorial, 'true');
      }
    };
    tut.classList.remove('hidden');
    renderSlide();
  }

  // Register service worker for PWA offline support
  async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const reg = await navigator.serviceWorker.register('./sw.js', { scope: './' });
        // Listen for updates
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          console.log('ServiceWorker controller changed');
        });
      } catch (err) {
        console.warn('ServiceWorker registration failed', err);
      }
    }
  }

  // Setup offline indicator
  function setupOfflineIndicator() {
    const indicator = document.getElementById('offline-indicator');
    function update() {
      indicator.classList.toggle('hidden', navigator.onLine);
    }
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    update();
  }

  // Pre-start user interaction to enable audio
  function enableAudioOnFirstInteraction() {
    function enable() {
      audioEnabled = true;
      updateBGM();
      document.removeEventListener('click', enable);
    }
    document.addEventListener('click', enable);
  }

  // Application initialization
  async function init() {
    loadSettings();
    applySettingsToUI();
    loadStores();
    loadHistory();
    loadTemplates();
    // Audio is initialized using inlined base64; call initAudio now
    initAudio();
    renderStores();
    renderHistory();
    renderTemplates();
    buildNumKeypad();
    buildCalculator();
    populateHelp();
    setupSettingsHandlers();
    setupOfflineIndicator();
    registerServiceWorker();
    enableAudioOnFirstInteraction();
    // numeric input open detection
    document.getElementById('add-product').addEventListener('click', () => { addProductRow(); playSound('add'); });
    document.getElementById('save-history').addEventListener('click', saveCurrentToHistory);
    document.getElementById('delete-all-history').addEventListener('click', deleteAllHistory);
    document.getElementById('import-from-history').addEventListener('click', () => {
      // provide simple import by prompting index
      if (!history.length) { alert('履歴がありません'); return; }
      const idxStr = prompt('履歴番号（1から）を指定してください', '1');
      const idx = parseInt(idxStr) - 1;
      if (!isNaN(idx) && idx >= 0 && idx < history.length) {
        const entry = history[idx];
        const name = prompt('テンプレ名を入力してください', entry.storeSnapshot.name + ' ' + new Date(entry.timestamp).toLocaleDateString());
        if (name) {
          templates.push({ id: generateId(), name, storeSnapshot: entry.storeSnapshot, items: entry.items });
          saveTemplates();
          renderTemplates();
          playSound('add');
        }
      }
    });
    // Tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    // Start button
    document.getElementById('start-button').addEventListener('click', () => {
      document.getElementById('start-screen').classList.add('hidden');
      document.getElementById('app').classList.remove('hidden');
      updateCalculation();
      updateBGM();
      // tutorial check
      if (!localStorage.getItem(LS_KEYS.tutorial)) {
        showTutorial();
      }
    });
    // Target amount input click -> numeric keypad
    document.getElementById('target-amount').addEventListener('click', (e) => openNumKeypad(e.target));
  }
  // Run init when DOM ready
  document.addEventListener('DOMContentLoaded', init);
})();