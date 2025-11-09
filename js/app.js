const THEME_STORAGE_KEY = 'smart-roulette-theme';
const HISTORY_STORAGE_KEY = 'smart-roulette-history';
const MAX_HISTORY_ITEMS = 20;
const WEIGHT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const dom = {
  body: document.body,
  menuToggle: document.getElementById('menuToggle'),
  sidePanel: document.getElementById('sidePanel'),
  modeButtons: {
    free: document.getElementById('modeFree'),
    range: document.getElementById('modeRange')
  },
  modeSections: {
    free: document.getElementById('freeMode'),
    range: document.getElementById('rangeMode')
  },
  freeInputs: document.getElementById('freeInputs'),
  rangeForm: document.getElementById('rangeForm'),
  rangeStart: document.getElementById('rangeStart'),
  rangeEnd: document.getElementById('rangeEnd'),
  rangeStep: document.getElementById('rangeStep'),
  rangePreview: document.getElementById('rangePreview'),
  wheelCanvas: document.getElementById('wheelCanvas'),
  wheelWrapper: document.querySelector('.wheel-wrapper'),
  spinButton: document.getElementById('spinButton'),
  spinResult: document.getElementById('spinResult'),
  historyList: document.getElementById('historyList'),
  saveHistory: document.getElementById('saveHistory'),
  clearHistory: document.getElementById('clearHistory'),
  themeButtons: Array.from(document.querySelectorAll('.theme-btn'))
};

const state = {
  mode: 'free',
  freeEntries: [],
  rangeConfig: { start: 1, end: 4, step: 1 },
  rangeEntries: [],
  rangeWeights: {},
  history: [],
  wheelSegments: [],
  currentRotation: 0,
  isSpinning: false
};

let idCounter = 0;

const createEntry = (value = '', weight = 1) => ({
  id: `entry-${Date.now()}-${idCounter++}`,
  value,
  weight
});

const getPreferredTheme = () => localStorage.getItem(THEME_STORAGE_KEY) || 'auto';

const applyTheme = (theme) => {
  dom.body.classList.remove('theme-auto', 'theme-light', 'theme-dark');
  dom.body.classList.add(`theme-${theme}`);
  dom.themeButtons.forEach((btn) => {
    const isActive = btn.dataset.theme === theme;
    btn.setAttribute('aria-pressed', String(isActive));
  });
};

const setupThemeToggle = () => {
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);
  dom.themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.theme;
      localStorage.setItem(THEME_STORAGE_KEY, theme);
      applyTheme(theme);
    });
  });
};

const setupMenuToggle = () => {
  if (!dom.menuToggle) return;
  dom.menuToggle.addEventListener('click', () => {
    const nextState = !dom.sidePanel.classList.contains('open');
    dom.sidePanel.classList.toggle('open', nextState);
    dom.body.classList.toggle('menu-open', nextState);
    dom.menuToggle.setAttribute('aria-expanded', String(nextState));
  });
};

const closeMenuOnMobile = () => {
  if (window.matchMedia('(max-width: 960px)').matches) {
    dom.sidePanel.classList.remove('open');
    dom.body.classList.remove('menu-open');
    dom.menuToggle?.setAttribute('aria-expanded', 'false');
  }
};

const buildWeightSelect = (current) => {
  const select = document.createElement('select');
  select.className = 'weight-select';
  WEIGHT_OPTIONS.forEach((weight) => {
    const option = document.createElement('option');
    option.value = String(weight);
    option.textContent = `${weight}x`;
    if (weight === current) {
      option.selected = true;
    }
    select.append(option);
  });
  return select;
};

const createFreeEntryRow = (entry, index) => {
  const row = document.createElement('div');
  row.className = 'entry-row';
  row.dataset.id = entry.id;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = `項目 ${index + 1}`;
  input.value = entry.value;
  input.dataset.id = entry.id;
  input.className = 'entry-input';

  const select = buildWeightSelect(entry.weight);
  select.dataset.id = entry.id;

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'entry-delete';
  removeButton.dataset.id = entry.id;
  removeButton.title = '項目を削除';
  removeButton.innerHTML = '×';

  row.append(input, select, removeButton);
  return row;
};

const renderFreeInputs = () => {
  dom.freeInputs.innerHTML = '';
  state.freeEntries.forEach((entry, index) => {
    dom.freeInputs.append(createFreeEntryRow(entry, index));
  });
};

// Ensures a single trailing blank field and keeps at least four input rows.
const ensureMinimumFreeEntries = () => {
  while (state.freeEntries.length < 4) {
    state.freeEntries.push(createEntry());
  }
};

// Keeps at least four rows and ensures there is at most one trailing blank.
const ensureFreeEntryStructure = ({ forceTrailingBlank = false } = {}) => {
  const beforeIds = state.freeEntries.map((entry) => entry.id);
  ensureMinimumFreeEntries();

  const lastEntry = state.freeEntries[state.freeEntries.length - 1];
  if (forceTrailingBlank && lastEntry && lastEntry.value.trim() !== '') {
    state.freeEntries.push(createEntry());
  }

  while (
    state.freeEntries.length > 4 &&
    state.freeEntries[state.freeEntries.length - 1].value.trim() === '' &&
    state.freeEntries[state.freeEntries.length - 2].value.trim() === ''
  ) {
    state.freeEntries.pop();
  }

  ensureMinimumFreeEntries();

  const afterIds = state.freeEntries.map((entry) => entry.id);
  if (beforeIds.length !== afterIds.length) {
    return true;
  }
  for (let i = 0; i < beforeIds.length; i += 1) {
    if (beforeIds[i] !== afterIds[i]) {
      return true;
    }
  }
  return false;
};

const isLastFreeEntry = (entryId) => {
  const last = state.freeEntries[state.freeEntries.length - 1];
  return last ? last.id === entryId : false;
};

const syncFreeInputsList = () => {
  const desiredLength = state.freeEntries.length;
  while (dom.freeInputs.children.length > desiredLength) {
    dom.freeInputs.removeChild(dom.freeInputs.lastElementChild);
  }
  for (let i = dom.freeInputs.children.length; i < desiredLength; i += 1) {
    const entry = state.freeEntries[i];
    dom.freeInputs.append(createFreeEntryRow(entry, i));
  }

  Array.from(dom.freeInputs.children).forEach((row, index) => {
    const entry = state.freeEntries[index];
    if (!entry) {
      return;
    }
    row.dataset.id = entry.id;
    const input = row.querySelector('.entry-input');
    if (input) {
      input.dataset.id = entry.id;
      input.placeholder = `項目 ${index + 1}`;
      if (input.value !== entry.value) {
        input.value = entry.value;
      }
    }
    const select = row.querySelector('.weight-select');
    if (select) {
      select.dataset.id = entry.id;
      if (select.value !== String(entry.weight)) {
        select.value = String(entry.weight);
      }
    }
    const deleteButton = row.querySelector('.entry-delete');
    if (deleteButton) {
      deleteButton.dataset.id = entry.id;
    }
  });
};

const setupFreeInputHandlers = () => {
  dom.freeInputs.addEventListener('input', (event) => {
    if (!event.target.matches('.entry-input')) {
      return;
    }
    if (event.isComposing || event.inputType === 'insertCompositionText') {
      return;
    }
    const { id } = event.target.dataset;
    const entry = state.freeEntries.find((item) => item.id === id);
    if (!entry) return;
    entry.value = event.target.value;
    updateWheel();
  });

  dom.freeInputs.addEventListener('compositionend', (event) => {
    if (!event.target.matches('.entry-input')) {
      return;
    }
    const { id } = event.target.dataset;
    const entry = state.freeEntries.find((item) => item.id === id);
    if (!entry) return;
    entry.value = event.target.value;
    updateWheel();
  });

  dom.freeInputs.addEventListener('focusin', (event) => {
    if (!event.target.matches('.entry-input')) {
      return;
    }
    const { id } = event.target.dataset;
    if (isLastFreeEntry(id)) {
      const structureChanged = ensureFreeEntryStructure({ forceTrailingBlank: true });
      if (structureChanged) {
        syncFreeInputsList();
      }
    }
  });

  dom.freeInputs.addEventListener('focusout', (event) => {
    if (!event.target.matches('.entry-input')) {
      return;
    }
    const { id } = event.target.dataset;
    const entry = state.freeEntries.find((item) => item.id === id);
    if (!entry) return;
    entry.value = event.target.value;
    const shouldForce = isLastFreeEntry(id) && entry.value.trim() !== '';
    const structureChanged = ensureFreeEntryStructure({ forceTrailingBlank: shouldForce });
    if (structureChanged) {
      syncFreeInputsList();
    }
    updateWheel();
  });

  dom.freeInputs.addEventListener('change', (event) => {
    if (!event.target.matches('.weight-select')) {
      return;
    }
    const { id } = event.target.dataset;
    const entry = state.freeEntries.find((item) => item.id === id);
    if (!entry) return;
    entry.weight = Number(event.target.value) || 1;
    updateWheel();
  });

  dom.freeInputs.addEventListener('click', (event) => {
    if (!event.target.matches('.entry-delete')) {
      return;
    }
    const { id } = event.target.dataset;
    state.freeEntries = state.freeEntries.filter((entry) => entry.id !== id);
    const structureChanged = ensureFreeEntryStructure({ forceTrailingBlank: true });
    if (structureChanged) {
      renderFreeInputs();
    }
    updateWheel();
  });
};

const initializeFreeMode = () => {
  state.freeEntries = Array.from({ length: 4 }, () => createEntry());
  renderFreeInputs();
  setupFreeInputHandlers();
};

const renderRangePreview = () => {
  dom.rangePreview.innerHTML = '';
  if (!state.rangeEntries.length) {
    const empty = document.createElement('p');
    empty.className = 'section-description';
    empty.textContent = '有効な範囲を入力してください。';
    dom.rangePreview.append(empty);
    return;
  }

  state.rangeEntries.forEach((value, index) => {
    const row = document.createElement('div');
    row.className = 'entry-row';
    row.dataset.value = String(value);

    const display = document.createElement('input');
    display.type = 'text';
    display.value = String(value);
    display.readOnly = true;
    display.tabIndex = -1;
    display.className = 'range-value';
    display.placeholder = `項目 ${index + 1}`;

    const select = buildWeightSelect(state.rangeWeights[value] || 1);
    select.dataset.value = String(value);

    const spacer = document.createElement('div');
    spacer.style.visibility = 'hidden';

    row.append(display, select, spacer);
    dom.rangePreview.append(row);
  });
};

const updateRangeEntries = () => {
  const start = Number(dom.rangeStart.value);
  const end = Number(dom.rangeEnd.value);
  const step = Math.max(1, Number(dom.rangeStep.value) || 1);
  if (Number.isNaN(start) || Number.isNaN(end)) {
    dom.rangePreview.innerHTML = '';
    return;
  }

  state.rangeConfig = { start, end, step };
  state.rangeEntries = [];

  if (start > end) {
    renderRangePreview();
    updateWheel();
    return;
  }

  for (let value = start; value <= end; value += step) {
    state.rangeEntries.push(value);
    if (!state.rangeWeights[value]) {
      state.rangeWeights[value] = 1;
    }
  }
  if (state.rangeEntries.length > 60) {
    state.rangeEntries = state.rangeEntries.slice(0, 60);
  }
  renderRangePreview();
  updateWheel();
};

const setupRangeHandlers = () => {
  dom.rangeForm.addEventListener('input', () => {
    updateRangeEntries();
  });

  dom.rangePreview.addEventListener('change', (event) => {
    if (event.target.matches('.weight-select')) {
      const value = Number(event.target.dataset.value);
      state.rangeWeights[value] = Number(event.target.value) || 1;
      updateWheel();
    }
  });
};

const initializeRangeMode = () => {
  dom.rangeStart.value = String(state.rangeConfig.start);
  dom.rangeEnd.value = String(state.rangeConfig.end);
  dom.rangeStep.value = String(state.rangeConfig.step);
  setupRangeHandlers();
  updateRangeEntries();
};

const setMode = (mode) => {
  state.mode = mode;
  Object.entries(dom.modeButtons).forEach(([key, button]) => {
    const isActive = key === mode;
    button.classList.toggle('active', isActive);
    button.setAttribute('aria-selected', String(isActive));
  });
  Object.entries(dom.modeSections).forEach(([key, section]) => {
    section.classList.toggle('hidden', key !== mode);
  });
  updateWheel();
  closeMenuOnMobile();
};

const setupModeSwitch = () => {
  dom.modeButtons.free.addEventListener('click', () => setMode('free'));
  dom.modeButtons.range.addEventListener('click', () => setMode('range'));
};

const getActiveEntries = () => {
  if (state.mode === 'free') {
    return state.freeEntries
      .filter((entry) => entry.value.trim() !== '')
      .map((entry) => ({ label: entry.value.trim(), weight: entry.weight }));
  }
  return state.rangeEntries.map((value) => ({
    label: String(value),
    weight: state.rangeWeights[value] || 1
  }));
};

const colorPalette = [
  '#3f8cff', '#ff6b6b', '#ffd166', '#06d6a0', '#a56bff', '#4cc9f0', '#f72585', '#f9c74f'
];

const drawWheel = (entries) => {
  const canvas = dom.wheelCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const { width } = canvas;
  const { height } = canvas;
  const radius = width / 2;
  ctx.clearRect(0, 0, width, height);

  if (!entries.length) {
    ctx.fillStyle = '#d3d3d3';
    ctx.beginPath();
    ctx.arc(width / 2, height / 2, radius - 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#555555';
    ctx.font = 'bold 16px "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('項目を追加してください', width / 2, height / 2 + 6);
    state.wheelSegments = [];
    dom.spinButton.disabled = true;
    return;
  }

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let startAngle = -Math.PI / 2;
  state.wheelSegments = [];

  entries.forEach((entry, index) => {
    const sliceAngle = (entry.weight / totalWeight) * Math.PI * 2;
    const endAngle = startAngle + sliceAngle;
    ctx.beginPath();
    ctx.moveTo(width / 2, height / 2);
    ctx.arc(width / 2, height / 2, radius - 4, startAngle, endAngle);
    ctx.closePath();
    ctx.fillStyle = colorPalette[index % colorPalette.length];
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.stroke();

    const textAngle = startAngle + sliceAngle / 2;
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(textAngle);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px "Segoe UI", sans-serif';
    const label = entry.label.length > 12 ? `${entry.label.slice(0, 11)}…` : entry.label;
    ctx.fillText(label, radius - 20, 6);
    ctx.restore();

    const startDeg = ((startAngle + Math.PI / 2) * 180 / Math.PI + 360) % 360;
    const endDegRaw = ((endAngle + Math.PI / 2) * 180 / Math.PI + 360) % 360;
    const endDeg = endDegRaw === startDeg ? endDegRaw + 360 : endDegRaw;
    state.wheelSegments.push({
      entry,
      startDeg,
      endDeg
    });

    startAngle = endAngle;
  });
  dom.spinButton.disabled = entries.length < 1;
};

const updateWheel = () => {
  const entries = getActiveEntries();
  drawWheel(entries);
};

const weightedRandomIndex = (entries) => {
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  let random = Math.random() * total;
  for (let i = 0; i < entries.length; i += 1) {
    random -= entries[i].weight;
    if (random <= 0) {
      return i;
    }
  }
  return entries.length - 1;
};

// Applies weighted selection and aligns the chosen slice with the indicator.
const spinWheel = () => {
  if (state.isSpinning) return;
  const entries = getActiveEntries();
  if (!entries.length) return;
  if (!state.wheelSegments.length) return;

  const segmentIndex = weightedRandomIndex(entries);
  const segment = state.wheelSegments[segmentIndex];
  const start = segment.startDeg;
  const end = segment.endDeg <= start ? segment.endDeg + 360 : segment.endDeg;
  const randomAngle = start + Math.random() * (end - start);
  const currentRotationMod = ((state.currentRotation % 360) + 360) % 360;
  const extraTurns = 3 + Math.floor(Math.random() * 3);
  let rotationDelta = extraTurns * 360 + (360 - randomAngle) - currentRotationMod;
  rotationDelta = ((rotationDelta % 360) + 360) % 360 + extraTurns * 360;
  const targetRotation = state.currentRotation + rotationDelta;

  state.isSpinning = true;
  dom.spinButton.disabled = true;
  dom.wheelWrapper.classList.add('spinning');
  dom.wheelWrapper.style.transform = `rotate(${targetRotation}deg)`;

  const handleTransitionEnd = (event) => {
    if (event.propertyName !== 'transform') return;
    dom.wheelWrapper.removeEventListener('transitionend', handleTransitionEnd);
    state.currentRotation = targetRotation % 360;
    state.isSpinning = false;
    dom.spinButton.disabled = false;
    dom.wheelWrapper.classList.remove('spinning');
    dom.spinResult.textContent = `結果: ${segment.entry.label}`;
  };

  dom.wheelWrapper.addEventListener('transitionend', handleTransitionEnd);
};

const persistHistory = () => {
  localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(state.history));
};

const loadHistory = () => {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.history = parsed;
    }
  } catch (error) {
    console.error('履歴の読み込みに失敗しました', error);
  }
};

const renderHistory = () => {
  dom.historyList.innerHTML = '';
  if (!state.history.length) {
    const empty = document.createElement('li');
    empty.className = 'section-description';
    empty.textContent = '保存された設定はありません。';
    dom.historyList.append(empty);
    return;
  }

  state.history
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((item) => {
      const li = document.createElement('li');
      li.className = 'history-item';
      li.dataset.id = String(item.id);

      const header = document.createElement('div');
      header.className = 'history-item-header';
      const title = document.createElement('strong');
      title.textContent = item.mode === 'free' ? '自由入力' : '範囲指定';
      const timestamp = new Date(item.createdAt).toLocaleString();
      const timeSpan = document.createElement('span');
      timeSpan.className = 'history-time';
      timeSpan.textContent = timestamp;
      header.append(title, timeSpan);

      const summary = document.createElement('div');
      summary.className = 'history-summary';
      const labels = item.mode === 'free'
        ? item.freeEntries.filter((entry) => entry.value.trim() !== '').map((entry) => entry.value.trim())
        : item.rangeEntries;
      summary.textContent = labels.slice(0, 5).join(', ') + (labels.length > 5 ? ' …' : '');

      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const loadButton = document.createElement('button');
      loadButton.type = 'button';
      loadButton.className = 'history-load';
      loadButton.textContent = '読み込む';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'history-delete';
      deleteButton.textContent = '削除';
      actions.append(loadButton, deleteButton);

      li.append(header, summary, actions);
      dom.historyList.append(li);
    });
};

const saveCurrentConfiguration = () => {
  const entries = getActiveEntries();
  if (!entries.length) {
    dom.spinResult.textContent = '保存可能な項目がありません。';
    return;
  }

  const item = {
    id: Date.now(),
    createdAt: Date.now(),
    mode: state.mode,
    freeEntries: state.freeEntries,
    rangeEntries: state.rangeEntries,
    rangeConfig: state.rangeConfig,
    rangeWeights: state.rangeWeights
  };

  state.history.push(JSON.parse(JSON.stringify(item)));
  if (state.history.length > MAX_HISTORY_ITEMS) {
    state.history = state.history
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_HISTORY_ITEMS);
  }
  persistHistory();
  renderHistory();
  dom.spinResult.textContent = '現在の設定を保存しました。';
};

const applyHistoryItem = (itemId) => {
  const item = state.history.find((historyItem) => String(historyItem.id) === String(itemId));
  if (!item) return;

  state.mode = item.mode;
  if (item.mode === 'free') {
    state.freeEntries = item.freeEntries.map((entry) => ({ ...entry }));
    ensureFreeEntryStructure({ forceTrailingBlank: true });
    renderFreeInputs();
  } else {
    state.rangeConfig = { ...item.rangeConfig };
    state.rangeEntries = [...item.rangeEntries];
    state.rangeWeights = { ...item.rangeWeights };
    dom.rangeStart.value = String(state.rangeConfig.start);
    dom.rangeEnd.value = String(state.rangeConfig.end);
    dom.rangeStep.value = String(state.rangeConfig.step);
    renderRangePreview();
  }
  setMode(item.mode);
  updateWheel();
  closeMenuOnMobile();
  dom.spinResult.textContent = '履歴の設定を読み込みました。';
};

const deleteHistoryItem = (itemId) => {
  state.history = state.history.filter((item) => String(item.id) !== String(itemId));
  persistHistory();
  renderHistory();
};

const setupHistoryHandlers = () => {
  dom.saveHistory.addEventListener('click', saveCurrentConfiguration);
  dom.clearHistory.addEventListener('click', () => {
    if (!state.history.length) return;
    if (window.confirm('履歴をすべて削除しますか？')) {
      state.history = [];
      persistHistory();
      renderHistory();
    }
  });

  dom.historyList.addEventListener('click', (event) => {
    const listItem = event.target.closest('.history-item');
    if (!listItem) return;
    const itemId = listItem.dataset.id;
    if (event.target.matches('.history-load')) {
      applyHistoryItem(itemId);
    }
    if (event.target.matches('.history-delete')) {
      deleteHistoryItem(itemId);
    }
  });
};

const initSpin = () => {
  dom.spinButton.addEventListener('click', spinWheel);
};

const init = () => {
  setupThemeToggle();
  setupMenuToggle();
  initializeFreeMode();
  initializeRangeMode();
  setupModeSwitch();
  loadHistory();
  renderHistory();
  setupHistoryHandlers();
  initSpin();
  updateWheel();
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
