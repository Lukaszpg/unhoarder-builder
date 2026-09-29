(function () {
  'use strict';

  const M = window.LootFilterModel;
  const WorkspaceStore = window.UnHoarderWorkspaceStore;
  if (!M) throw new Error('LootFilterModel failed to load.');

  const $ = id => document.getElementById(id);
  const state = {
    filter: { version: 3, rules: [] },
    selected: -1,
    data: {},
    files: {},
    catalog: M.buildCatalog({}),
    dataPanelCollapsed: false,
    dataPanelWasComplete: false
  };

  const FILE_SLOTS = [
    { key: 'weapons', label: 'weapons.txt', role: 'Core · base names / item types', required: true },
    { key: 'armor', label: 'armor.txt', role: 'Core · base names / item types', required: true },
    { key: 'misc', label: 'misc.txt', role: 'Core · item types', required: true },
    { key: 'itemtypes', label: 'itemtypes.txt', role: 'Core · type hierarchy', required: true },
    { key: 'uniques', label: 'UniqueItems.txt', role: 'Optional · unique lookup', required: false },
    { key: 'sets', label: 'SetItems.txt', role: 'Optional · set lookup', required: false }
  ];

  let persistenceReady = false;
  let persistenceAvailable = Boolean(WorkspaceStore && WorkspaceStore.isSupported());
  let workspaceSaveTimer = null;
  let persistenceChain = Promise.resolve();
  let draggedRuleIndex = -1;
  let dragInsertIndex = -1;
  let ruleDragPointerY = null;
  let ruleDragScrollFrame = null;
  let dropSoundPreviewAudio = null;
  const RULE_DRAG_SCROLL_EDGE = 88;
  const RULE_DRAG_SCROLL_MAX_STEP = 24;

  function setLocalSaveStatus(text, mode = '') {
    const node = $('localSaveStatus');
    if (!node) return;
    node.textContent = text;
    node.className = `local-save-status${mode ? ` ${mode}` : ''}`;
  }

  function disablePersistence(message) {
    persistenceAvailable = false;
    if (workspaceSaveTimer !== null) {
      window.clearTimeout(workspaceSaveTimer);
      workspaceSaveTimer = null;
    }
    setLocalSaveStatus(message || 'Local save unavailable', 'error');
  }

  function enqueuePersistence(task) {
    if (!persistenceAvailable) return Promise.resolve();
    persistenceChain = persistenceChain
      .then(task)
      .catch(err => {
        console.error('UnHoarder local workspace error:', err);
        disablePersistence('Local save unavailable');
      });
    return persistenceChain;
  }

  function flushWorkspaceSave() {
    if (!persistenceReady || !persistenceAvailable) return;
    if (workspaceSaveTimer !== null) {
      window.clearTimeout(workspaceSaveTimer);
      workspaceSaveTimer = null;
    }
    const filterSnapshot = clone(state.filter);
    const selectedSnapshot = state.selected;
    const uiSnapshot = { dataPanelCollapsed: state.dataPanelCollapsed };
    setLocalSaveStatus('Saving locally…', 'saving');
    enqueuePersistence(async () => {
      await Promise.all([
        WorkspaceStore.saveFilter(filterSnapshot, selectedSnapshot),
        WorkspaceStore.saveUi(uiSnapshot)
      ]);
      setLocalSaveStatus('Saved locally', 'saved');
    });
  }

  function scheduleWorkspaceSave(delay = 350) {
    if (!persistenceReady || !persistenceAvailable) return;
    if (workspaceSaveTimer !== null) window.clearTimeout(workspaceSaveTimer);
    setLocalSaveStatus('Saving locally…', 'saving');
    workspaceSaveTimer = window.setTimeout(() => {
      workspaceSaveTimer = null;
      flushWorkspaceSave();
    }, delay);
  }

  function persistDataFile(kind, name, text) {
    if (!persistenceReady || !persistenceAvailable) return;
    setLocalSaveStatus('Saving locally…', 'saving');
    enqueuePersistence(async () => {
      await WorkspaceStore.saveFile(kind, name, text);
      setLocalSaveStatus('Saved locally', 'saved');
    });
  }

  function removePersistedDataFile(kind) {
    if (!persistenceReady || !persistenceAvailable) return;
    setLocalSaveStatus('Saving locally…', 'saving');
    enqueuePersistence(async () => {
      await WorkspaceStore.deleteFile(kind);
      setLocalSaveStatus('Saved locally', 'saved');
    });
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function toast(message, error) {
    document.querySelectorAll('.toast').forEach(x => x.remove());
    const node = el('div', `toast${error ? ' error' : ''}`, message);
    document.body.appendChild(node);
    window.setTimeout(() => node.remove(), 2600);
  }

  function clone(value) { return M.clone(value); }

  function currentEntry() {
    return state.selected >= 0 && state.selected < state.filter.rules.length ? state.filter.rules[state.selected] : null;
  }
  function currentBlock() {
    const entry = currentEntry();
    return entry ? M.ruleBlock(entry) : null;
  }
  function ensureConditions(block) {
    if (!block.conditions || typeof block.conditions !== 'object') block.conditions = {};
    return block.conditions;
  }
  function cleanupConditions(block) {
    if (block.conditions && !Object.keys(block.conditions).length) delete block.conditions;
  }
  function normalizeMultiValue(value) {
    if (Array.isArray(value)) return [...value];
    return value === undefined ? [] : [value];
  }
  function setMultiCondition(block, key, values) {
    const c = ensureConditions(block);
    const result = M.compactStringOrArray(values);
    if (result === undefined) delete c[key]; else c[key] = result;
    cleanupConditions(block);
    renderAll();
  }

  function hasCompleteDataSet() {
    return FILE_SLOTS.every(slot => {
      const info = state.files[slot.key];
      return Boolean(state.data[slot.key] && info && !info.error);
    });
  }

  function renderFileStatus() {
    const grid = $('fileStatusGrid');
    grid.innerHTML = '';
    for (const slot of FILE_SLOTS) {
      const info = state.files[slot.key];
      const card = el('div', `file-card${info ? (info.error ? ' error' : ' loaded') : ''}`);
      card.appendChild(el('div', 'file-name', slot.label));
      card.appendChild(el('div', 'file-role', slot.role));
      let status = slot.required ? 'Required for full catalog mode' : 'Optional';
      if (info && info.error) status = info.error;
      else if (info) status = `${info.name} · ${info.rows.toLocaleString()} rows`;
      card.appendChild(el('div', 'file-state', status));
      grid.appendChild(card);
    }

    const coreLoaded = ['weapons','armor','misc','itemtypes'].filter(k => state.data[k]).length;
    const c = state.catalog;
    const bits = [];
    bits.push(`${coreLoaded}/4 core files`);
    if (c.baseItems.length) bits.push(`${c.baseItems.length.toLocaleString()} item rows`);
    if (c.baseNames.length) bits.push(`${c.baseNames.length.toLocaleString()} weapon/armor base names`);
    if (c.itemTypes.length) bits.push(`${c.itemTypes.length.toLocaleString()} resolved item-type selectors`);
    if (c.uniqueItems.length) bits.push(`${c.uniqueItems.length.toLocaleString()} uniques`);
    if (c.setItems.length) bits.push(`${c.setItems.length.toLocaleString()} set items`);
    $('catalogSummary').textContent = bits.join(' · ');

    const compact = $('compactFileStatus');
    compact.innerHTML = '';
    for (const slot of FILE_SLOTS) {
      const info = state.files[slot.key];
      if (!info || info.error) continue;
      const badge = el('div', 'file-mini-badge loaded');
      badge.title = `${slot.label} — ${info.rows.toLocaleString()} rows`;
      badge.appendChild(el('span', 'file-mini-check', '✓'));
      badge.appendChild(el('span', 'file-mini-name', info.name));
      badge.appendChild(el('span', 'file-mini-count', info.rows.toLocaleString()));
      compact.appendChild(badge);
    }

    const complete = hasCompleteDataSet();
    const hasLoadedData = Object.values(state.files).some(info => info && !info.error);

    // Auto-collapse once when a complete six-file data set is first reached.
    // After that, a manual expand remains respected until the data set becomes incomplete.
    if (complete && !state.dataPanelWasComplete) state.dataPanelCollapsed = true;
    if (!hasLoadedData) state.dataPanelCollapsed = false;
    state.dataPanelWasComplete = complete;

    const collapsed = state.dataPanelCollapsed && hasLoadedData;
    $('dataExpanded').hidden = collapsed;
    $('dataCompactBar').hidden = !collapsed;
    $('dataPanel').classList.toggle('collapsed', collapsed);
    $('dataPanel').classList.toggle('has-data', hasLoadedData);
    $('dataPanel').setAttribute('aria-expanded', String(!collapsed));
    $('clearDataBtn').disabled = !Object.keys(state.files).length;
  }

  async function handleDataFiles(fileList) {
    for (const file of [...fileList]) {
      const kind = M.classifyDataFilename(file.name);
      if (!kind) {
        toast(`Ignored unsupported file: ${file.name}`, true);
        continue;
      }
      try {
        const text = await file.text();
        const parsed = (kind === 'uniques' || kind === 'sets')
          ? M.parseEnrichmentTable(kind, text)
          : M.parseCoreTable(kind, text);
        state.data[kind] = parsed;
        state.files[kind] = { name: file.name, rows: parsed.rows.length, error: '' };
        persistDataFile(kind, file.name, text);
      } catch (err) {
        delete state.data[kind];
        state.files[kind] = { name: file.name, rows: 0, error: err.message || String(err) };
        removePersistedDataFile(kind);
      }
    }
    state.catalog = M.buildCatalog(state.data);
    renderAll();
  }

  function clearData() {
    state.data = {};
    state.files = {};
    state.catalog = M.buildCatalog({});
    state.dataPanelCollapsed = false;
    state.dataPanelWasComplete = false;
    if (persistenceReady && persistenceAvailable) {
      setLocalSaveStatus('Saving locally…', 'saving');
      enqueuePersistence(async () => {
        await WorkspaceStore.clearFiles();
        setLocalSaveStatus('Saved locally', 'saved');
      });
    }
    renderAll();
  }

  function toggleDataPanel() {
    const hasLoadedData = Object.values(state.files).some(info => info && !info.error);
    if (!hasLoadedData) return;
    state.dataPanelCollapsed = !state.dataPanelCollapsed;
    renderFileStatus();
    scheduleWorkspaceSave();
  }

  function addRule(kind, rule) {
    const entry = rule || M.makeRule(kind);
    state.filter.rules.push(entry);
    state.selected = state.filter.rules.length - 1;
    renderAll();
  }

  function switchRuleKind(index, kind) {
    const entry = state.filter.rules[index];
    const block = clone(M.ruleBlock(entry));
    state.filter.rules[index] = { [kind]: block };
    renderAll();
  }

  function moveRule(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= state.filter.rules.length) return;
    const tmp = state.filter.rules[index];
    state.filter.rules[index] = state.filter.rules[target];
    state.filter.rules[target] = tmp;
    state.selected = target;
    renderAll();
  }

  function reorderRule(fromIndex, insertionIndex) {
    const rules = state.filter.rules;
    if (fromIndex < 0 || fromIndex >= rules.length) return;
    const selectedEntry = state.selected >= 0 ? rules[state.selected] : null;
    const [moved] = rules.splice(fromIndex, 1);
    let target = insertionIndex;
    if (fromIndex < target) target -= 1;
    target = Math.max(0, Math.min(target, rules.length));
    rules.splice(target, 0, moved);
    state.selected = selectedEntry ? rules.indexOf(selectedEntry) : -1;
    renderAll();
  }

  function updateRuleDropIndicator(clientY) {
    if (draggedRuleIndex < 0) return;
    const list = $('ruleList');
    if (!list) return;
    const cards = Array.from(list.querySelectorAll('.rule-card'));
    if (!cards.length) {
      dragInsertIndex = 0;
      return;
    }

    let insertion = state.filter.rules.length;
    let indicatorCard = cards[cards.length - 1];
    let before = false;
    for (const candidate of cards) {
      const rect = candidate.getBoundingClientRect();
      const candidateIndex = Number(candidate.dataset.ruleIndex);
      if (clientY < rect.top + rect.height / 2) {
        insertion = candidateIndex;
        indicatorCard = candidate;
        before = true;
        break;
      }
      insertion = candidateIndex + 1;
      indicatorCard = candidate;
      before = false;
    }

    dragInsertIndex = insertion;
    cards.forEach(card => card.classList.remove('drag-before', 'drag-after'));
    if (indicatorCard) indicatorCard.classList.add(before ? 'drag-before' : 'drag-after');
  }

  function ruleDragScrollableAncestor() {
    let node = $('ruleList');
    while (node && node !== document.body && node !== document.documentElement) {
      const style = window.getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 1) return node;
      node = node.parentElement;
    }
    return null;
  }

  function ruleDragScrollStep() {
    ruleDragScrollFrame = null;
    if (draggedRuleIndex < 0 || !Number.isFinite(ruleDragPointerY)) return;

    const scrollContainer = ruleDragScrollableAncestor();
    let step = 0;

    if (scrollContainer) {
      const rect = scrollContainer.getBoundingClientRect();
      const upper = rect.top + RULE_DRAG_SCROLL_EDGE;
      const lower = rect.bottom - RULE_DRAG_SCROLL_EDGE;
      if (ruleDragPointerY < upper) {
        const strength = Math.min(1, Math.max(0, (upper - ruleDragPointerY) / RULE_DRAG_SCROLL_EDGE));
        step = -Math.max(2, Math.round(RULE_DRAG_SCROLL_MAX_STEP * strength));
      } else if (ruleDragPointerY > lower) {
        const strength = Math.min(1, Math.max(0, (ruleDragPointerY - lower) / RULE_DRAG_SCROLL_EDGE));
        step = Math.max(2, Math.round(RULE_DRAG_SCROLL_MAX_STEP * strength));
      }
      if (step) scrollContainer.scrollTop += step;
    } else {
      const topbar = document.querySelector('.topbar');
      const stickyBottom = topbar && window.getComputedStyle(topbar).position === 'sticky'
        ? Math.max(0, topbar.getBoundingClientRect().bottom)
        : 0;
      const upper = Math.min(window.innerHeight - RULE_DRAG_SCROLL_EDGE, stickyBottom + RULE_DRAG_SCROLL_EDGE);
      const lower = window.innerHeight - RULE_DRAG_SCROLL_EDGE;

      if (ruleDragPointerY < upper) {
        const strength = Math.min(1, Math.max(0, (upper - ruleDragPointerY) / RULE_DRAG_SCROLL_EDGE));
        step = -Math.max(2, Math.round(RULE_DRAG_SCROLL_MAX_STEP * strength));
      } else if (ruleDragPointerY > lower) {
        const strength = Math.min(1, Math.max(0, (ruleDragPointerY - lower) / RULE_DRAG_SCROLL_EDGE));
        step = Math.max(2, Math.round(RULE_DRAG_SCROLL_MAX_STEP * strength));
      }
      if (step) window.scrollBy(0, step);
    }

    if (step) updateRuleDropIndicator(ruleDragPointerY);
    ruleDragScrollFrame = window.requestAnimationFrame(ruleDragScrollStep);
  }

  function trackRuleDragPointer(event) {
    if (draggedRuleIndex < 0) return;
    ruleDragPointerY = event.clientY;
    if (ruleDragScrollFrame === null) {
      ruleDragScrollFrame = window.requestAnimationFrame(ruleDragScrollStep);
    }
  }

  function startRuleDragAutoScroll(clientY) {
    ruleDragPointerY = clientY;
    document.addEventListener('dragover', trackRuleDragPointer);
    if (ruleDragScrollFrame === null) {
      ruleDragScrollFrame = window.requestAnimationFrame(ruleDragScrollStep);
    }
  }

  function stopRuleDragAutoScroll() {
    document.removeEventListener('dragover', trackRuleDragPointer);
    ruleDragPointerY = null;
    if (ruleDragScrollFrame !== null) {
      window.cancelAnimationFrame(ruleDragScrollFrame);
      ruleDragScrollFrame = null;
    }
  }

  function clearRuleDragState() {
    stopRuleDragAutoScroll();
    draggedRuleIndex = -1;
    dragInsertIndex = -1;
    document.querySelectorAll('.rule-card.dragging, .rule-card.drag-before, .rule-card.drag-after')
      .forEach(card => card.classList.remove('dragging', 'drag-before', 'drag-after'));
  }

  function duplicateRule(index) {
    state.filter.rules.splice(index + 1, 0, clone(state.filter.rules[index]));
    state.selected = index + 1;
    renderAll();
  }

  function deleteRule(index) {
    state.filter.rules.splice(index, 1);
    if (!state.filter.rules.length) state.selected = -1;
    else state.selected = Math.min(index, state.filter.rules.length - 1);
    renderAll();
  }

  function renderRuleList() {
    const list = $('ruleList');
    list.innerHTML = '';
    $('emptyRules').hidden = state.filter.rules.length > 0;

    list.ondragover = event => {
      if (draggedRuleIndex < 0 || event.target !== list) return;
      event.preventDefault();
      updateRuleDropIndicator(event.clientY);
    };
    list.ondrop = event => {
      if (draggedRuleIndex < 0 || event.target !== list) return;
      event.preventDefault();
      const from = draggedRuleIndex;
      const insertion = dragInsertIndex < 0 ? state.filter.rules.length : dragInsertIndex;
      clearRuleDragState();
      reorderRule(from, insertion);
    };

    state.filter.rules.forEach((entry, index) => {
      const summary = M.summarizeRule(entry);
      const card = el('div', `rule-card${index === state.selected ? ' selected' : ''}`);
      card.draggable = true;
      card.dataset.ruleIndex = String(index);
      card.setAttribute('aria-grabbed', 'false');
      card.title = 'Drag to reorder';
      card.addEventListener('click', () => { state.selected = index; renderAll(); });
      card.addEventListener('dragstart', event => {
        if (event.target.closest('button')) {
          event.preventDefault();
          return;
        }
        draggedRuleIndex = index;
        dragInsertIndex = index;
        card.classList.add('dragging');
        startRuleDragAutoScroll(event.clientY);
        card.setAttribute('aria-grabbed', 'true');
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', String(index));
        }
      });
      card.addEventListener('dragover', event => {
        if (draggedRuleIndex < 0) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
        updateRuleDropIndicator(event.clientY);
      });
      card.addEventListener('drop', event => {
        if (draggedRuleIndex < 0) return;
        event.preventDefault();
        event.stopPropagation();
        const from = draggedRuleIndex;
        const insertion = dragInsertIndex < 0 ? index : dragInsertIndex;
        clearRuleDragState();
        reorderRule(from, insertion);
      });
      card.addEventListener('dragend', () => {
        card.setAttribute('aria-grabbed', 'false');
        clearRuleDragState();
      });

      const dragHandle = el('div', 'rule-drag-handle');
      dragHandle.setAttribute('aria-hidden', 'true');
      dragHandle.innerHTML = '<svg viewBox="0 0 10 24" aria-hidden="true"><circle cx="3" cy="5" r="1.4"/><circle cx="7" cy="5" r="1.4"/><circle cx="3" cy="12" r="1.4"/><circle cx="7" cy="12" r="1.4"/><circle cx="3" cy="19" r="1.4"/><circle cx="7" cy="19" r="1.4"/></svg>';

      const content = el('div', 'rule-card-content');
      const title = el('div', 'rule-title');
      title.appendChild(el('span', `rule-kind ${summary.kind}`, summary.kind));
      title.appendChild(document.createTextNode(' '));
      title.appendChild(el('span', 'rule-index', `#${index + 1}`));
      if (summary.ruleName) {
        const displayName = el('span', 'rule-display-name', summary.ruleName);
        displayName.title = summary.ruleName;
        title.appendChild(displayName);
      }
      content.appendChild(title);
      content.appendChild(el('div', 'rule-summary', summary.conditionSummary));
      content.appendChild(el('div', 'rule-icons', summary.actionSummary));

      const controls = el('div', 'rule-card-controls');
      const actions = el('div', 'row-actions');
      const up = el('button', 'button icon ghost', '↑'); up.title = 'Move up'; up.disabled = index === 0;
      const down = el('button', 'button icon ghost', '↓'); down.title = 'Move down'; down.disabled = index === state.filter.rules.length - 1;
      [up,down].forEach(b => { b.draggable = false; b.addEventListener('click', e => e.stopPropagation()); });
      up.addEventListener('click', () => moveRule(index, -1));
      down.addEventListener('click', () => moveRule(index, 1));
      actions.append(up, down);
      controls.appendChild(actions);

      const ruleActions = el('div', 'rule-card-secondary-actions');
      const duplicate = el('button', 'button icon ghost rule-duplicate-icon');
      duplicate.type = 'button';
      duplicate.draggable = false;
      duplicate.title = 'Duplicate rule';
      duplicate.setAttribute('aria-label', `Duplicate rule ${index + 1}`);
      duplicate.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V4h12v12h-3v4H4V7h4Zm2 0h7v7h1V6h-8v1Zm-4 2v9h9V9H6Z"/></svg>';
      duplicate.addEventListener('click', event => { event.stopPropagation(); duplicateRule(index); });

      const remove = el('button', 'button icon danger rule-delete-icon');
      remove.type = 'button';
      remove.draggable = false;
      remove.title = 'Delete rule';
      remove.setAttribute('aria-label', `Delete rule ${index + 1}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Zm-2 6h10l-.7 11H7.7L7 9Zm3 2v7h2v-7h-2Zm4 0v7h2v-7h-2Z"/></svg>';
      remove.addEventListener('click', event => { event.stopPropagation(); deleteRule(index); });

      ruleActions.append(duplicate, remove);
      controls.appendChild(ruleActions);

      card.append(dragHandle, content, controls);
      list.appendChild(card);
    });
  }

  function finderDataset() {
    const out = [];
    const seen = new Set();
    for (const item of state.catalog.baseItems) {
      if (!item.name && !item.code) continue;
      const key = `base:${item.kind}:${item.code}:${item.name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...item, search: `${item.name} ${item.code} ${item.type} ${item.type2}`.toLowerCase() });
    }
    state.catalog.uniqueItems.forEach(item => out.push({ ...item, search: `${item.name} ${item.baseName} ${item.baseCode}`.toLowerCase() }));
    state.catalog.setItems.forEach(item => out.push({ ...item, search: `${item.name} ${item.baseName} ${item.baseCode}`.toLowerCase() }));
    return out;
  }

  function renderFinder() {
    const input = $('itemFinderInput');
    const results = $('itemFinderResults');
    const q = input.value.trim().toLowerCase();
    results.innerHTML = '';
    if (!q) return;
    const matches = finderDataset().filter(x => x.search.includes(q)).slice(0, 24);
    if (!matches.length) {
      results.appendChild(el('div', 'help', state.catalog.baseItems.length ? 'No matching loaded item.' : 'Load Excel data to search the item catalog.'));
      return;
    }
    for (const item of matches) {
      const row = el('div', 'finder-result');
      const left = el('div');
      const display = item.name || item.code;
      left.appendChild(el('div', '', display));
      let meta = '';
      if (item.kind === 'unique' || item.kind === 'set') meta = `${item.baseName || item.baseCode} · ${item.kind}`;
      else meta = `${item.code} · ${item.kind}`;
      left.appendChild(el('div', 'finder-meta', meta));
      row.appendChild(left);
      const buttons = el('div', 'row-actions');
      const show = el('button', 'button small', '+ Show');
      const hide = el('button', 'button small ghost', '+ Hide');
      show.addEventListener('click', e => { e.stopPropagation(); addRule('show', M.createRuleForFinderItem(item, 'show')); input.value=''; renderFinder(); });
      hide.addEventListener('click', e => { e.stopPropagation(); addRule('hide', M.createRuleForFinderItem(item, 'hide')); input.value=''; renderFinder(); });
      buttons.append(show, hide);
      row.appendChild(buttons);
      results.appendChild(row);
    }
  }

  function renderChooser(parent, opts) {
    const template = $('conditionChooserTemplate');
    const node = template.content.firstElementChild.cloneNode(true);
    node.querySelector('.chooser-title').textContent = opts.title;
    node.querySelector('.chooser-help').textContent = opts.help;
    const input = node.querySelector('.chooser-input');
    input.placeholder = opts.placeholder;
    const chips = node.querySelector('.chooser-chips');
    const suggestions = node.querySelector('.chooser-suggestions');
    const block = currentBlock();
    const current = normalizeMultiValue((block.conditions || {})[opts.key]);

    const paintChips = () => {
      chips.innerHTML = '';
      current.forEach((value, idx) => {
        const chip = el('span', 'chip');
        chip.appendChild(document.createTextNode(value));
        const x = el('button', '', '×');
        x.type = 'button'; x.title = 'Remove';
        x.addEventListener('click', () => { current.splice(idx,1); setMultiCondition(block, opts.key, current); });
        chip.appendChild(x); chips.appendChild(chip);
      });
    };

    const addValue = value => {
      const v = String(value || '').trim();
      if (!v || current.includes(v)) return;
      current.push(v);
      setMultiCondition(block, opts.key, current);
    };

    const paintSuggestions = () => {
      suggestions.innerHTML = '';
      const q = input.value.trim().toLowerCase();
      if (!q || !opts.options.length) return;
      opts.options.filter(v => String(v).toLowerCase().includes(q) && !current.includes(v)).slice(0,12).forEach(value => {
        const s = el('div', 'suggestion', value);
        s.addEventListener('mousedown', e => { e.preventDefault(); addValue(value); });
        suggestions.appendChild(s);
      });
    };
    node.querySelector('.chooser-add').addEventListener('click', () => addValue(input.value));
    input.addEventListener('input', paintSuggestions);
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addValue(input.value); } });
    input.addEventListener('blur', () => window.setTimeout(() => { suggestions.innerHTML=''; }, 120));
    paintChips();
    parent.appendChild(node);
  }

  function makeSection(title, note) {
    const section = el('div', 'editor-section');
    const head = el('div', 'editor-section-title');
    head.appendChild(el('strong', '', title));
    if (note) head.appendChild(el('span', '', note));
    section.appendChild(head);
    return section;
  }

  function renderRarity(parent, block) {
    const c = block.conditions || {};
    const current = normalizeMultiValue(c.rarity);
    const grid = el('div', 'checkbox-grid');
    for (const rarity of M.RARITIES) {
      const label = el('label', 'check-pill');
      const box = document.createElement('input'); box.type='checkbox'; box.checked=current.includes(rarity);
      box.addEventListener('change', () => {
        const values = normalizeMultiValue((block.conditions || {}).rarity);
        const next = box.checked ? [...values, rarity] : values.filter(x => x !== rarity);
        setMultiCondition(block, 'rarity', next);
      });
      label.append(box, document.createTextNode(rarity)); grid.appendChild(label);
    }
    parent.appendChild(grid);
  }

  function renderNumericCard(parent, block, key, title, min, max) {
    const c = block.conditions || {};
    const test = c[key] || {};
    const card = el('div', 'numeric-card');
    card.appendChild(el('strong', '', title));

    const setTest = next => {
      const cond = ensureConditions(block);
      Object.keys(next).forEach(k => { if (next[k] === '' || next[k] === undefined || next[k] === null || Number.isNaN(next[k])) delete next[k]; });
      if (Object.keys(next).length) cond[key] = next; else delete cond[key];
      cleanupConditions(block); renderAll(false);
    };
    const numberInput = (labelText, operator, value) => {
      const row = el('div', 'bound-row');
      row.appendChild(el('span', 'help', labelText));
      const inp = el('input', 'number-input'); inp.type='number'; inp.min=String(min); inp.max=String(max); inp.step='1'; inp.value=value ?? '';
      inp.addEventListener('change', () => { const next={...(block.conditions || {})[key]}; if(inp.value==='') delete next[operator]; else next[operator]=Number(inp.value); setTest(next); });
      row.appendChild(inp); card.appendChild(row);
    };
    numberInput('Equals', 'eq', test.eq);

    const minRow = el('div', 'bound-row');
    const minSel = el('select', 'select-input');
    [['','No min'],['gt','>'],['gte','≥']].forEach(([v,t]) => { const o=el('option','',t);o.value=v;o.selected=(v && v in test);minSel.appendChild(o); });
    const minInput = el('input','number-input'); minInput.type='number'; minInput.min=String(min); minInput.max=String(max); minInput.step='1';
    const activeMin = 'gt' in test ? 'gt' : ('gte' in test ? 'gte' : ''); minSel.value=activeMin; minInput.value=activeMin ? test[activeMin] : '';
    const commitMin=()=>{const next={...(block.conditions||{})[key]};delete next.gt;delete next.gte;if(minSel.value&&minInput.value!=='')next[minSel.value]=Number(minInput.value);setTest(next);};
    minSel.addEventListener('change',commitMin); minInput.addEventListener('change',commitMin); minRow.append(minSel,minInput); card.appendChild(minRow);

    const maxRow = el('div', 'bound-row');
    const maxSel = el('select', 'select-input');
    [['','No max'],['lt','<'],['lte','≤']].forEach(([v,t]) => { const o=el('option','',t);o.value=v;o.selected=(v && v in test);maxSel.appendChild(o); });
    const maxInput = el('input','number-input'); maxInput.type='number'; maxInput.min=String(min); maxInput.max=String(max); maxInput.step='1';
    const activeMax = 'lt' in test ? 'lt' : ('lte' in test ? 'lte' : ''); maxSel.value=activeMax; maxInput.value=activeMax ? test[activeMax] : '';
    const commitMax=()=>{const next={...(block.conditions||{})[key]};delete next.lt;delete next.lte;if(maxSel.value&&maxInput.value!=='')next[maxSel.value]=Number(maxInput.value);setTest(next);};
    maxSel.addEventListener('change',commitMax); maxInput.addEventListener('change',commitMax); maxRow.append(maxSel,maxInput); card.appendChild(maxRow);
    parent.appendChild(card);
  }

  function renderBooleanCondition(parent, block, key, title) {
    const wrap = el('div', 'field');
    const label = el('label', '', title);
    const select = el('select', 'select-input');
    [['','Any'],['true','True'],['false','False']].forEach(([v,t]) => { const o=el('option','',t);o.value=v;select.appendChild(o); });
    const c=block.conditions||{}; select.value = key in c ? String(c[key]) : '';
    select.addEventListener('change', () => { const cond=ensureConditions(block); if(select.value==='') delete cond[key]; else cond[key]=select.value==='true'; cleanupConditions(block); renderAll(false); });
    wrap.append(label,select); parent.appendChild(wrap);
  }

  function tooltipPreviewText(block) {
    if (block.name) return block.name;
    const conditions = block.conditions || {};
    const first = value => Array.isArray(value) ? value[0] : value;
    return first(conditions.baseName) || first(conditions.code) || 'Item Name';
  }

  function cssRgba(value, fallback) {
    const parsed = M.parseRgba(value);
    return parsed ? `rgba(${parsed.r}, ${parsed.g}, ${parsed.b}, ${parsed.a})` : fallback;
  }

  function applyTooltipVisualization(sample, block) {
    if (!sample) return;
    sample.textContent = tooltipPreviewText(block);
    sample.style.backgroundColor = cssRgba(block.tooltip && block.tooltip.backgroundColor, 'rgba(0, 0, 0, 0.82)');
    sample.style.color = cssRgba(block.tooltip && block.tooltip.textColor, 'rgba(255, 255, 255, 1)');
  }

  function refreshTooltipVisualization(block) {
    applyTooltipVisualization(document.querySelector('#ruleEditor .tooltip-visualization-label'), block);
  }

  function renderTooltipVisualization(parent, block) {
    const card = el('div', 'action-card tooltip-visualization-card');
    const title = el('div', 'tooltip-visualization-title');
    title.appendChild(el('strong', '', 'Tooltip preview'));
    title.appendChild(el('span', 'help', 'Approximate ground-label color preview'));
    card.appendChild(title);

    const stage = el('div', 'tooltip-visualization-stage');
    const sample = el('div', 'tooltip-visualization-label');
    applyTooltipVisualization(sample, block);
    stage.appendChild(sample);
    card.appendChild(stage);
    card.appendChild(el('span', 'help', 'Uses the custom ground name when set; otherwise the first base name or item code. Game font and exact geometry may differ.'));
    parent.appendChild(card);
  }

  function setTooltipColor(block, key, enabled, hex, alpha, rebuildEditor) {
    if (enabled) {
      block.tooltip = block.tooltip || {};
      block.tooltip[key] = M.rgbaString(hex, alpha);
    } else if (block.tooltip) {
      delete block.tooltip[key];
      if (!Object.keys(block.tooltip).length) delete block.tooltip;
    }
    renderAll(!!rebuildEditor);
    if (!rebuildEditor) refreshTooltipVisualization(block);
  }

  function renderColorAction(parent, block, key, title, defaultHex, defaultAlpha) {
    const existing = block.tooltip && block.tooltip[key];
    const parsed = M.rgbaToHex(existing || M.rgbaString(defaultHex, defaultAlpha));
    const card = el('div', `action-card${existing ? '' : ' disabled'}`);
    const head=el('div','action-card-head');
    const checkLabel=el('label','inline-check');
    const check=document.createElement('input');check.type='checkbox';check.checked=!!existing;
    checkLabel.append(check,document.createTextNode(title)); head.appendChild(checkLabel); card.appendChild(head);
    const fields=el('div','color-field');
    const color=document.createElement('input');color.type='color';color.value=parsed.hex;color.disabled=!existing;
    const rgba=el('input','text-input');rgba.value=existing||M.rgbaString(parsed.hex,parsed.alpha);rgba.readOnly=true;rgba.disabled=!existing;
    const alpha=el('input','number-input');alpha.type='number';alpha.min='0';alpha.max='1';alpha.step='0.01';alpha.value=String(parsed.alpha);alpha.disabled=!existing;
    const commit=(rebuild)=>{ rgba.value=M.rgbaString(color.value,alpha.value); setTooltipColor(block,key,check.checked,color.value,alpha.value,rebuild); };
    check.addEventListener('change',()=>commit(true));color.addEventListener('input',()=>commit(false));alpha.addEventListener('change',()=>commit(false));
    fields.append(color,rgba,alpha);card.appendChild(fields); parent.appendChild(card);
  }

  function renderRuleEditor() {
    const editor = $('ruleEditor');
    const empty = $('ruleEditorEmpty');
    const entry = currentEntry();
    if (!entry) { editor.hidden=true; empty.hidden=false; return; }
    editor.hidden=false; empty.hidden=true; editor.innerHTML='';
    const block = currentBlock();
    const kind = M.ruleKind(entry);

    const header = el('div','editor-header');
    const left=el('div');
    const seg=el('div','segmented');
    const show=el('button',`${kind==='show'?'active show':''}`,'Show');
    const hide=el('button',`${kind==='hide'?'active hide':''}`,'Hide');
    show.addEventListener('click',()=>switchRuleKind(state.selected,'show'));hide.addEventListener('click',()=>switchRuleKind(state.selected,'hide'));
    seg.append(show,hide);left.appendChild(seg);header.appendChild(left);
    editor.appendChild(header);

    const ruleNameCard=el('div','condition-block rule-name-card');
    const ruleNameHead=el('div','condition-title-row');
    ruleNameHead.appendChild(el('strong','','Rule name'));
    ruleNameHead.appendChild(el('span','help','Builder label only · ignored by UnHoarder at runtime'));
    ruleNameCard.appendChild(ruleNameHead);
    const ruleNameInput=el('input','text-input');
    ruleNameInput.type='text';
    ruleNameInput.placeholder='e.g. High-value currency';
    ruleNameInput.value=typeof block.ruleName==='string'?block.ruleName:'';
    ruleNameInput.addEventListener('input',()=>{
      if(ruleNameInput.value)block.ruleName=ruleNameInput.value;else delete block.ruleName;
      renderPreview();renderRuleList();
    });
    ruleNameCard.appendChild(ruleNameInput);
    editor.appendChild(ruleNameCard);

    const flow = makeSection('Flow', 'Ordered rules · first match stops unless Continue is enabled');
    const contLabel=el('label','inline-check');const cont=document.createElement('input');cont.type='checkbox';cont.checked=!!block.continue;
    cont.addEventListener('change',()=>{if(cont.checked)block.continue=true;else delete block.continue;renderAll(false);});
    contLabel.append(cont,document.createTextNode('Continue evaluating later rules after this match'));flow.appendChild(contLabel);editor.appendChild(flow);

    const conditions = makeSection('Conditions', 'Fields are ANDed; arrays inside a field are ORed');
    renderChooser(conditions,{key:'code',title:'Item code',help:'1–4 printable ASCII bytes. Manual values are allowed.',placeholder:'e.g. r33',options:state.catalog.baseItems.map(x=>x.code).filter((v,i,a)=>a.indexOf(v)===i).sort()});
    renderChooser(conditions,{key:'baseName',title:'Base name',help:'Literal name from weapons.txt / armor.txt only.',placeholder:'e.g. Shako',options:state.catalog.baseNames});
    renderChooser(conditions,{key:'itemType',title:'Item type',help:'ItemTypes Code or literal ItemType name, expanded through Equiv1/Equiv2.',placeholder:'e.g. swor or Sword',options:state.catalog.itemTypes});

    const rarityBlock=el('div','condition-block');
    const rr=el('div','condition-title-row');rr.appendChild(el('strong','','Rarity'));rr.appendChild(el('span','help','Any combination of the supported D2R quality families.'));rarityBlock.appendChild(rr);renderRarity(rarityBlock,block);conditions.appendChild(rarityBlock);

    const numeric=el('div','numeric-grid');
    renderNumericCard(numeric,block,'quantity','Quantity',0,65535);
    renderNumericCard(numeric,block,'itemLevel','Item level',1,99);
    renderNumericCard(numeric,block,'sockets','Sockets',0,15);
    const other=el('div','numeric-card other-condition-card');
    other.appendChild(el('strong','','Other'));
    const bools=el('div','two-col');renderBooleanCondition(bools,block,'ethereal','Ethereal');renderBooleanCondition(bools,block,'identified','Identified');other.appendChild(bools);numeric.appendChild(other);
    conditions.appendChild(numeric);
    editor.appendChild(conditions);

    // Hide rules only control visibility in the Builder UI. Preserve any
    // existing action metadata so switching back to Show is non-destructive,
    // but do not render the Actions editor while this rule is Hide.
    if (kind === 'hide') return;

    const actions = makeSection('Actions', 'Optional styling, sound, name and minimap actions');
    const nameCard=el('div','action-card');const nameTitle=el('div','condition-title-row');nameTitle.appendChild(el('strong','','Custom ground name'));nameCard.appendChild(nameTitle);
    const nameArea=document.createElement('textarea');nameArea.placeholder='Optional custom label (ASCII, max 79 bytes / 3 lines)';nameArea.value=block.name||'';
    nameArea.addEventListener('input',()=>{if(nameArea.value)block.name=nameArea.value;else delete block.name;renderPreview();renderRuleList();refreshTooltipVisualization(block);});
    nameCard.appendChild(nameArea);nameCard.appendChild(el('span','help','Max 3 non-empty lines, 55 characters per line, 79 ASCII bytes total.'));actions.appendChild(nameCard);

    renderColorAction(actions,block,'backgroundColor','Tooltip background','#6e23a0',0.82);
    renderColorAction(actions,block,'textColor','Tooltip text','#b48cff',1);
    renderTooltipVisualization(actions,block);

    const soundCard=el('div','action-card');soundCard.appendChild(el('strong','','Drop sound'));
    const soundRow=el('div','sound-action-row');
    const sound=el('select','select-input');
    const noSound=el('option','','No sound');noSound.value='';sound.appendChild(noSound);
    M.DROP_SOUNDS.forEach(name=>{const option=el('option','',name);option.value=name;sound.appendChild(option);});
    if(block.dropSound && !M.DROP_SOUNDS.includes(block.dropSound)){
      const unsupported=el('option','',`Unsupported: ${block.dropSound}`);unsupported.value=block.dropSound;sound.appendChild(unsupported);
    }
    sound.value=block.dropSound||'';
    const play=el('button','button icon ghost sound-preview-button');play.type='button';play.title='Preview selected sound at 50% volume';play.setAttribute('aria-label','Preview selected drop sound');
    play.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7L8 5Z"/></svg>';
    play.disabled=!M.DROP_SOUNDS.includes(sound.value);
    sound.addEventListener('change',()=>{
      if(M.DROP_SOUNDS.includes(sound.value))block.dropSound=sound.value;else delete block.dropSound;
      play.disabled=!M.DROP_SOUNDS.includes(sound.value);
      renderPreview();renderRuleList();
    });
    play.addEventListener('click',()=>{
      const selected=sound.value;
      if(!M.DROP_SOUNDS.includes(selected))return;
      if(dropSoundPreviewAudio){dropSoundPreviewAudio.pause();dropSoundPreviewAudio.currentTime=0;}
      const audio=new Audio(`assets/sounds/${selected}.flac`);
      audio.volume=0.5;
      dropSoundPreviewAudio=audio;
      play.disabled=true;
      const finish=()=>{if(dropSoundPreviewAudio===audio)dropSoundPreviewAudio=null;play.disabled=!M.DROP_SOUNDS.includes(sound.value);};
      audio.addEventListener('ended',finish,{once:true});
      audio.addEventListener('error',()=>{finish();toast(`Could not preview ${selected}.`,true);},{once:true});
      audio.play().catch(()=>{finish();toast(`Could not preview ${selected}.`,true);});
    });
    soundRow.append(sound,play);soundCard.appendChild(soundRow);
    soundCard.appendChild(el('span','help','Filter01–Filter16. Preview plays the bundled FLAC at 50% volume.'));actions.appendChild(soundCard);

    const mini=block.minimapIcon;
    const miniCard=el('div',`action-card${mini?'':' disabled'}`);const miniHead=el('div','action-card-head');
    const miniCheckLabel=el('label','inline-check');const miniCheck=document.createElement('input');miniCheck.type='checkbox';miniCheck.checked=!!mini;
    miniCheckLabel.append(miniCheck,document.createTextNode('Minimap icon'));miniHead.appendChild(miniCheckLabel);miniCard.appendChild(miniHead);
    const miniFields=el('div','three-col');
    const shapeWrap=el('div','field');shapeWrap.appendChild(el('label','','Shape'));const shape=el('select','select-input');M.MINIMAP_SHAPES.forEach(s=>{const o=el('option','',s);o.value=s;shape.appendChild(o);});shape.value=mini?.shape||'diamond';shape.disabled=!mini;shapeWrap.appendChild(shape);
    const sizeWrap=el('div','field');sizeWrap.appendChild(el('label','','Size (px)'));const size=el('input','number-input');size.type='number';size.step='1';size.value=mini?.size ?? 12;size.disabled=!mini;sizeWrap.appendChild(size);
    const noteWrap=el('div','field');noteWrap.appendChild(el('label','','Renderer'));noteWrap.appendChild(el('span','help','12–40 px. Values outside this range are clamped by the plugin.'));
    miniFields.append(shapeWrap,sizeWrap,noteWrap);miniCard.appendChild(miniFields);
    const colors=el('div','two-col');
    function miniColor(labelText,key,def) { const wrap=el('div','field');wrap.appendChild(el('label','',labelText));const parsed=M.rgbaToHex(mini?.[key]||M.rgbaString(def,0.82));const line=el('div','color-field');const col=document.createElement('input');col.type='color';col.value=parsed.hex;col.disabled=!mini;const txt=el('input','text-input');txt.value=mini?.[key]||M.rgbaString(def,parsed.alpha);txt.readOnly=true;txt.disabled=!mini;const a=el('input','number-input');a.type='number';a.min='0';a.max='1';a.step='0.01';a.value=String(parsed.alpha);a.disabled=!mini;line.append(col,txt,a);wrap.appendChild(line);colors.appendChild(wrap);return {col,a,txt}; }
    const border=miniColor('Border color','borderColor','#e1cdff');const fill=miniColor('Fill color','fillColor','#b48cff');miniCard.appendChild(colors);
    const commitMini=(rebuild)=>{
      if(!miniCheck.checked){delete block.minimapIcon;renderAll(!!rebuild);return;}
      border.txt.value=M.rgbaString(border.col.value,border.a.value);
      fill.txt.value=M.rgbaString(fill.col.value,fill.a.value);
      block.minimapIcon={shape:shape.value,borderColor:border.txt.value,fillColor:fill.txt.value};
      if(size.value!=='')block.minimapIcon.size=Number(size.value);
      renderAll(!!rebuild);
    };
    miniCheck.addEventListener('change',()=>commitMini(true));shape.addEventListener('change',()=>commitMini(false));size.addEventListener('change',()=>commitMini(false));border.col.addEventListener('input',()=>commitMini(false));border.a.addEventListener('change',()=>commitMini(false));fill.col.addEventListener('input',()=>commitMini(false));fill.a.addEventListener('change',()=>commitMini(false));
    actions.appendChild(miniCard);
    editor.appendChild(actions);

  }

  function renderPreview() {
    const result = M.validateFilter(state.filter, state.catalog);
    $('jsonPreview').textContent = result.json;
    $('ruleCount').textContent = state.filter.rules.length.toLocaleString();
    $('byteCount').textContent = result.bytes.toLocaleString();
    const badge=$('validationBadge');
    badge.className='badge ' + (result.errors.length?'bad':result.warnings.length?'warn':'good');
    badge.textContent=result.errors.length?'Invalid':result.warnings.length?'Valid · warnings':'Valid';
    if (!state.filter.rules.length && !result.errors.length) { badge.className='badge neutral'; badge.textContent='Empty'; }
    const messages=$('validationMessages');messages.innerHTML='';
    result.errors.slice(0,10).forEach(m=>messages.appendChild(el('div','validation-item error',m)));
    result.warnings.slice(0,8).forEach(m=>messages.appendChild(el('div','validation-item warning',m)));
    if(result.errors.length>10)messages.appendChild(el('div','validation-item error',`+ ${result.errors.length-10} more errors`));
    const valid=!result.errors.length;
    $('downloadBtn').disabled=!valid;
    scheduleWorkspaceSave();
    return result;
  }

  function renderAll(rebuildEditor = true) {
    renderFileStatus();
    renderRuleList();
    renderFinder();
    if (rebuildEditor) renderRuleEditor();
    renderPreview();
  }

  function downloadFilter() {
    const result=renderPreview();
    if(result.errors.length){toast('Fix validation errors before downloading.',true);return;}
    const blob=new Blob([result.json],{type:'application/json'});
    const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='filter.json';document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
  }

  async function importFilter(file) {
    try {
      const parsed=JSON.parse(await file.text());
      if(parsed.version!==3)throw new Error('This editor imports canonical schema v3 filters only. UnHoarder can still migrate older schemas at runtime.');
      const test=M.validateFilter(parsed,state.catalog);
      if(test.errors.length)throw new Error(test.errors.slice(0,3).join(' '));
      state.filter=parsed;state.selected=parsed.rules.length?0:-1;renderAll();toast(`Imported ${file.name}`);
    } catch(err){toast(`Import failed: ${err.message||err}`,true);}
  }

  async function copyJson() {
    const result=renderPreview();
    try { await navigator.clipboard.writeText(result.json); toast('JSON copied to clipboard.'); }
    catch { toast('Clipboard access was blocked by the browser.',true); }
  }

  async function restoreLocalWorkspace() {
    if (!persistenceAvailable) return { restored: false, versionMismatch: false };
    const saved = await WorkspaceStore.loadWorkspace();
    let restored = false;

    for (const slot of FILE_SLOTS) {
      const record = saved.files[slot.key];
      if (!record) continue;
      if (M.classifyDataFilename(record.name) !== slot.key) {
        removePersistedDataFile(slot.key);
        continue;
      }
      restored = true;
      try {
        const parsed = (slot.key === 'uniques' || slot.key === 'sets')
          ? M.parseEnrichmentTable(slot.key, record.text)
          : M.parseCoreTable(slot.key, record.text);
        state.data[slot.key] = parsed;
        state.files[slot.key] = { name: record.name, rows: parsed.rows.length, error: '' };
      } catch (err) {
        delete state.data[slot.key];
        state.files[slot.key] = {
          name: record.name || slot.label,
          rows: 0,
          error: `Saved file could not be restored: ${err.message || String(err)}`
        };
      }
    }
    state.catalog = M.buildCatalog(state.data);

    if (saved.filter && saved.filter.filter && saved.filter.filter.version === 3 && Array.isArray(saved.filter.filter.rules)) {
      state.filter = saved.filter.filter;
      const last = state.filter.rules.length - 1;
      const selected = Number.isInteger(saved.filter.selected) ? saved.filter.selected : -1;
      state.selected = last >= 0 ? Math.max(0, Math.min(selected < 0 ? 0 : selected, last)) : -1;
      restored = true;
    }

    if (saved.ui) {
      state.dataPanelCollapsed = Boolean(saved.ui.dataPanelCollapsed);
      // Preserve a user's manually-expanded complete data set on the first render after restoration.
      state.dataPanelWasComplete = hasCompleteDataSet();
      restored = true;
    }

    return { restored, versionMismatch: saved.versionMismatch };
  }

  function wireEvents() {
    $('addShowBtn').addEventListener('click',()=>addRule('show'));
    $('addHideBtn').addEventListener('click',()=>addRule('hide'));
    $('downloadBtn').addEventListener('click',downloadFilter);
    $('copyBtn').addEventListener('click',copyJson);
    $('newFilterBtn').addEventListener('click',()=>{if(state.filter.rules.length&&!confirm('Discard the current filter and start a new one?'))return;state.filter={version:3,rules:[]};state.selected=-1;renderAll();});
    $('importFilterBtn').addEventListener('click',()=>$('filterImportInput').click());
    $('filterImportInput').addEventListener('change',e=>{const f=e.target.files[0];if(f)importFilter(f);e.target.value='';});
    $('clearDataBtn').addEventListener('click',clearData);
    $('itemFinderInput').addEventListener('input',renderFinder);

    const dataPanel=$('dataPanel');
    dataPanel.addEventListener('click',e=>{
      // Keep native controls interactive. Everywhere else on the panel toggles its folded state.
      if (e.target.closest('button, input, .drop-zone')) return;
      toggleDataPanel();
    });
    const zone=$('dropZone'),input=$('dataFileInput');
    zone.addEventListener('click',()=>input.click());
    zone.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
    input.addEventListener('change',e=>{handleDataFiles(e.target.files);e.target.value='';});
    ['dragenter','dragover'].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.add('dragover');}));
    ['dragleave','drop'].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.remove('dragover');}));
    zone.addEventListener('drop',e=>handleDataFiles(e.dataTransfer.files));
  }

  async function initialize() {
    let restoreResult = { restored: false, versionMismatch: false };
    if (!persistenceAvailable) {
      setLocalSaveStatus('Local save unavailable', 'error');
    } else {
      setLocalSaveStatus('Loading local workspace…', 'saving');
      try {
        restoreResult = await restoreLocalWorkspace();
      } catch (err) {
        console.error('Unable to restore the UnHoarder local workspace:', err);
        disablePersistence('Local save unavailable');
      }
    }

    renderAll();
    wireEvents();
    persistenceReady = persistenceAvailable;

    if (persistenceAvailable) {
      if (restoreResult.versionMismatch) {
        setLocalSaveStatus('Autosave ready · older local data ignored', 'warning');
      } else if (restoreResult.restored) {
        setLocalSaveStatus('Restored locally', 'saved');
      } else {
        setLocalSaveStatus('Autosave ready', 'saved');
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushWorkspaceSave();
    });
    window.addEventListener('pagehide', flushWorkspaceSave);
  }

  initialize();
})();
