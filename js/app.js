const THEME_STORAGE_KEY = 'smart-roulette-theme';
const HISTORY_STORAGE_KEY = 'smart-roulette-history';
const AUTO_HISTORY_STORAGE_KEY = 'smart-roulette-auto-history';
const MAX_HISTORY_ITEMS = 20;
const MAX_AUTO_HISTORY_ITEMS = 50;
const WEIGHT_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const dom = {
  body: document.body,
  menuToggle: document.getElementById('menuToggle'),
  sidePanel: document.getElementById('sidePanel'),
  tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
  sections: {
    free: document.getElementById('freeMode'),
    range: document.getElementById('rangeMode'),
    saved: document.getElementById('savedMode'),
    history: document.getElementById('historyMode')
  },
  freeInputs: document.getElementById('freeInputs'),
  rangeForm: document.getElementById('rangeForm'),
  rangeStart: document.getElementById('rangeStart'),
  rangeEnd: document.getElementById('rangeEnd'),
  rangeStep: document.getElementById('rangeStep'),
  rangePreview: document.getElementById('rangePreview'),
  wheelCanvas: document.getElementById('wheelCanvas'),
  wheelWrapper: document.querySelector('.wheel-wrapper'),
  wheelSection: document.querySelector('.wheel-section'),
  spinButton: document.getElementById('spinButton'),
  spinResult: document.getElementById('spinResult'),
  historyList: document.getElementById('historyList'),
  clearHistory: document.getElementById('clearHistory'),
  autoHistoryList: document.getElementById('autoHistoryList'),
  saveCurrentButtons: Array.from(document.querySelectorAll('[data-action="save-current"]')),
  themeButtons: Array.from(document.querySelectorAll('.theme-btn')),
  toast: document.getElementById('toast')
};

const TAB_KEYS = ['free', 'range', 'saved', 'history'];
const tabButtonGroups = TAB_KEYS.reduce((groups, key) => {
  groups[key] = [];
  return groups;
}, {});

dom.tabButtons.forEach((button) => {
  const tab = button.dataset.tab;
  if (!tab || !tabButtonGroups[tab]) {
    return;
  }
  tabButtonGroups[tab].push(button);
});

const state = {
  mode: 'free',
  activeTab: 'free',
  freeEntries: [],
  rangeConfig: { start: 1, end: 4, step: 1 },
  rangeEntries: [],
  rangeWeights: {},
  history: [],
  autoHistory: [],
  wheelSegments: [],
  currentRotation: 0,
  isSpinning: false,
  wheelStates: {
    free: { rotation: 0, result: '' },
    range: { rotation: 0, result: '' }
  },
  wheelPendingRestores: {
    free: false,
    range: false
  }
};

let idCounter = 0;
let toastTimeoutId = null;

const normalizeRotation = (angle = 0) => ((Number(angle) % 360) + 360) % 360;

if (typeof window !== 'undefined' && !Array.isArray(window.__pendingToasts)) {
  window.__pendingToasts = [];
}

const RANGE_MESSAGES = {
  startAdjusted: '開始値が終了値を超えたため、終了値に合わせました。',
  startAdjustedByEnd: '終了値の変更に合わせて開始値を調整しました。',
  endAdjusted: '終了値が開始値より小さいため、開始値に合わせました。'
};

const enforceRangeBounds = ({ source = 'sync', silent = false, adjust = true } = {}) => {
  if (!dom.rangeStart || !dom.rangeEnd) {
    return false;
  }

  let adjusted = false;
  const startRaw = dom.rangeStart.value;
  const endRaw = dom.rangeEnd.value;
  const hasStartValue = startRaw !== '' && !Number.isNaN(Number(startRaw));
  const hasEndValue = endRaw !== '' && !Number.isNaN(Number(endRaw));
  const startValue = hasStartValue ? Number(startRaw) : null;
  const endValue = hasEndValue ? Number(endRaw) : null;

  if (hasStartValue && startValue !== null) {
    dom.rangeEnd.min = String(startValue);
  } else {
    dom.rangeEnd.removeAttribute('min');
  }

  if (!hasEndValue || endValue === null) {
    dom.rangeStart.removeAttribute('max');
  } else {
    dom.rangeStart.max = String(endValue);
  }

  if (adjust && hasStartValue && hasEndValue && startValue !== null && endValue !== null) {
    if (source === 'start' && endValue < startValue) {
      dom.rangeEnd.value = String(startValue);
      adjusted = true;
      if (!silent) {
        showToast(RANGE_MESSAGES.endAdjusted);
      }
    } else if (source === 'end' && startValue > endValue) {
      dom.rangeStart.value = String(endValue);
      adjusted = true;
      if (!silent) {
        showToast(RANGE_MESSAGES.startAdjustedByEnd);
      }
    } else if (source === 'sync' && startValue > endValue) {
      dom.rangeStart.value = String(endValue);
      dom.rangeEnd.value = String(endValue);
      adjusted = true;
      if (!silent) {
        showToast(RANGE_MESSAGES.startAdjusted);
      }
    }
  }

  return adjusted;
};

const hideToast = () => {
  if (!dom.toast) return;
  dom.toast.classList.remove('visible');
  dom.toast.setAttribute('aria-hidden', 'true');
  toastTimeoutId = null;
};

const showToast = (message) => {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.setAttribute('aria-hidden', 'false');
  dom.toast.classList.add('visible');
  if (toastTimeoutId) {
    window.clearTimeout(toastTimeoutId);
  }
  toastTimeoutId = window.setTimeout(() => {
    hideToast();
  }, 2000);
};

const setWheelTransform = (angle, { immediate = false } = {}) => {
  if (!dom.wheelWrapper) return;
  if (immediate) {
    dom.wheelWrapper.classList.add('no-transition');
  }
  dom.wheelWrapper.style.transform = `rotate(${angle}deg)`;
  if (immediate) {
    void dom.wheelWrapper.offsetWidth;
    dom.wheelWrapper.classList.remove('no-transition');
  }
};

const getWheelState = (mode) => {
  if (!mode) {
    return { rotation: 0, result: '' };
  }
  if (!state.wheelStates[mode]) {
    state.wheelStates[mode] = { rotation: 0, result: '' };
  }
  return state.wheelStates[mode];
};

const applyWheelState = (mode) => {
  if (!mode) return;
  const wheelState = getWheelState(mode);
  state.currentRotation = normalizeRotation(Number.isFinite(wheelState.rotation) ? wheelState.rotation : 0);
  dom.wheelWrapper?.classList.remove('spinning');
  setWheelTransform(state.currentRotation, { immediate: true });
  if (dom.spinResult && state.activeTab === mode) {
    dom.spinResult.textContent = wheelState.result || '';
  }
};

const resetWheelDisplay = (mode = state.mode, { updateStore = false } = {}) => {
  if (!mode) return;
  state.currentRotation = 0;
  dom.wheelWrapper?.classList.remove('spinning');
  setWheelTransform(0, { immediate: true });
  if (dom.spinResult && state.activeTab === mode) {
    dom.spinResult.textContent = '';
  }
  if (updateStore) {
    state.wheelStates[mode] = { rotation: 0, result: '' };
    state.wheelPendingRestores[mode] = false;
  }
};

const storeWheelState = (mode = state.mode) => {
  if (!mode) return;
  const existing = getWheelState(mode);
  const resultText = dom.spinResult && state.activeTab === mode ? dom.spinResult.textContent || '' : existing.result || '';
  if (state.mode === mode) {
    state.currentRotation = normalizeRotation(state.currentRotation);
  }
  const rotation = state.mode === mode ? normalizeRotation(state.currentRotation) : normalizeRotation(existing.rotation || 0);
  state.wheelStates[mode] = {
    rotation,
    result: resultText
  };
};

window.addEventListener('app:toast', (event) => {
  const { detail } = event;
  const message = typeof detail?.message === 'string' ? detail.message.trim() : '';
  if (!message) {
    return;
  }
  showToast(message);
});

window.__toastEmitterReady = true;
if (Array.isArray(window.__pendingToasts) && window.__pendingToasts.length) {
  const queued = [...window.__pendingToasts];
  window.__pendingToasts.length = 0;
  queued.forEach((message) => {
    if (typeof message === 'string' && message.trim()) {
      showToast(message.trim());
    }
  });
}

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
  if (!dom.menuToggle || !dom.sidePanel) return;

  const handleOutsidePoint = (event) => {
    if (!dom.sidePanel.classList.contains('open')) {
      return;
    }
    if (!window.matchMedia('(max-width: 1079px)').matches) {
      return;
    }
    if (dom.sidePanel.contains(event.target)) {
      return;
    }
    if (dom.menuToggle.contains(event.target)) {
      return;
    }
    closeMenuOnMobile();
  };

  const outsideEvent = typeof window !== 'undefined' && 'PointerEvent' in window ? 'pointerdown' : 'mousedown';
  document.addEventListener(outsideEvent, handleOutsidePoint);

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') {
      return;
    }
    if (!dom.sidePanel.classList.contains('open')) {
      return;
    }
    closeMenuOnMobile();
  });

  dom.menuToggle.addEventListener('click', () => {
    const nextState = !dom.sidePanel.classList.contains('open');
    dom.sidePanel.classList.toggle('open', nextState);
    dom.body.classList.toggle('menu-open', nextState);
    dom.menuToggle.setAttribute('aria-expanded', String(nextState));
  });
};

const closeMenuOnMobile = () => {
  if (window.matchMedia('(max-width: 1079px)').matches) {
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
    const targetIndex = state.freeEntries.findIndex((entry) => entry.id === id);
    if (targetIndex === -1) {
      return;
    }
    state.freeEntries.splice(targetIndex, 1);
    ensureFreeEntryStructure({ forceTrailingBlank: true });
    renderFreeInputs();
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
  const handleInput = (source) => {
    enforceRangeBounds({ source, silent: true, adjust: false });
    updateRangeEntries();
  };

  const handleBlur = (source) => {
    enforceRangeBounds({ source });
    updateRangeEntries();
  };

  if (dom.rangeStart) {
    dom.rangeStart.addEventListener('input', () => handleInput('start'));
    dom.rangeStart.addEventListener('blur', () => handleBlur('start'));
  }

  if (dom.rangeEnd) {
    dom.rangeEnd.addEventListener('input', () => handleInput('end'));
    dom.rangeEnd.addEventListener('blur', () => handleBlur('end'));
  }

  if (dom.rangeStep) {
    const handleStepChange = () => {
      updateRangeEntries();
    };
    dom.rangeStep.addEventListener('input', handleStepChange);
    dom.rangeStep.addEventListener('change', handleStepChange);
  }

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
  enforceRangeBounds({ source: 'sync', silent: true });
  updateRangeEntries();
};

const updateTabUI = () => {
  Object.entries(tabButtonGroups).forEach(([key, buttons]) => {
    const isActive = state.activeTab === key;
    buttons.forEach((button) => {
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-selected', String(isActive));
    });
  });
  Object.entries(dom.sections).forEach(([key, section]) => {
    if (!section) return;
    section.classList.toggle('hidden', state.activeTab !== key);
  });
  if (dom.wheelSection) {
    const shouldShowWheel = state.activeTab === 'free' || state.activeTab === 'range';
    dom.wheelSection.classList.toggle('hidden', !shouldShowWheel);
  }
};

const isWheelTab = (value) => value === 'free' || value === 'range';

const setActiveTab = (tab) => {
  if (!TAB_KEYS.includes(tab)) {
    return;
  }

  if (tab === state.activeTab) {
    if (isWheelTab(tab)) {
      updateWheel();
      applyWheelState(tab);
    }
    closeMenuOnMobile();
    return;
  }

  const previousMode = state.mode;
  const previousActiveTab = state.activeTab;

  if (isWheelTab(previousActiveTab) && isWheelTab(previousMode)) {
    storeWheelState(previousMode);
    state.wheelPendingRestores[previousMode] = true;
  }

  state.activeTab = tab;

  if (isWheelTab(tab)) {
    state.mode = tab;
    updateTabUI();
    updateWheel();
    if (state.wheelPendingRestores[tab]) {
      applyWheelState(tab);
      state.wheelPendingRestores[tab] = false;
    } else {
      resetWheelDisplay(tab, { updateStore: false });
    }
  } else {
    updateTabUI();
    if (isWheelTab(previousMode)) {
      state.wheelPendingRestores[previousMode] = true;
    }
    if (dom.spinResult) {
      dom.spinResult.textContent = '';
    }
  }

  closeMenuOnMobile();
};

const setupTabSwitch = () => {
  dom.tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { tab } = button.dataset;
      if (!tab) return;
      setActiveTab(tab);
    });
  });
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
    resetWheelDisplay(state.mode, { updateStore: true });
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

const formatTimestamp = (timestamp) => {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleString();
};

const getDefaultHistoryName = (mode, timestamp) => {
  const base = mode === 'free' ? '自由入力' : '範囲指定';
  const formatted = formatTimestamp(timestamp);
  return formatted ? `${base} (${formatted})` : base;
};

const getModeLabel = (mode) => (mode === 'free' ? '自由入力' : '範囲指定');

const cloneFreeEntries = (entries = []) => entries.map((entry) => ({ ...entry }));

const cloneRangeEntries = (entries = []) => (Array.isArray(entries) ? [...entries] : []);

const cloneRangeWeights = (weights = {}) => {
  const cloned = {};
  Object.entries(weights || {}).forEach(([key, value]) => {
    cloned[key] = value;
  });
  return cloned;
};

const captureConfigurationSnapshot = () => ({
  mode: state.mode,
  freeEntries: cloneFreeEntries(state.freeEntries),
  rangeEntries: cloneRangeEntries(state.rangeEntries),
  rangeConfig: { ...state.rangeConfig },
  rangeWeights: cloneRangeWeights(state.rangeWeights)
});

const getSnapshotLabels = (snapshot) => {
  if (!snapshot) return [];
  if (snapshot.mode === 'free') {
    return cloneFreeEntries(snapshot.freeEntries || [])
      .filter((entry) => typeof entry.value === 'string' && entry.value.trim() !== '')
      .map((entry) => entry.value.trim());
  }
  return cloneRangeEntries(snapshot.rangeEntries || []).map((value) => String(value));
};

const applyConfigurationSnapshot = (snapshot, { activateTab = true } = {}) => {
  if (!snapshot) return;
  const mode = snapshot.mode === 'range' ? 'range' : 'free';

  if (mode === 'free') {
    state.freeEntries = cloneFreeEntries(snapshot.freeEntries || []);
    ensureFreeEntryStructure({ forceTrailingBlank: true });
    renderFreeInputs();
  } else {
    const config = snapshot.rangeConfig || state.rangeConfig;
    state.rangeConfig = {
      start: Number(config.start ?? 1),
      end: Number(config.end ?? 4),
      step: Number(config.step ?? 1) || 1
    };
    state.rangeEntries = cloneRangeEntries(snapshot.rangeEntries || []);
    state.rangeWeights = cloneRangeWeights(snapshot.rangeWeights || {});
    dom.rangeStart.value = String(state.rangeConfig.start);
    dom.rangeEnd.value = String(state.rangeConfig.end);
    dom.rangeStep.value = String(state.rangeConfig.step);
    enforceRangeBounds({ source: 'sync', silent: true });
    updateRangeEntries();
  }

  state.mode = mode;
  if (activateTab) {
    if (state.activeTab === mode && (mode === 'free' || mode === 'range')) {
      resetWheelDisplay(mode, { updateStore: true });
    }
    setActiveTab(mode);
  } else {
    updateWheel();
  }
};

const buildSnapshotFromHistoryItem = (item) => {
  if (!item) return null;
  return {
    mode: item.mode === 'range' ? 'range' : 'free',
    freeEntries: cloneFreeEntries(item.freeEntries || []),
    rangeEntries: cloneRangeEntries(item.rangeEntries || []),
    rangeConfig: { ...item.rangeConfig },
    rangeWeights: cloneRangeWeights(item.rangeWeights || {})
  };
};

const addHistoryItemFromSnapshot = (snapshot, { name, createdAt } = {}) => {
  if (!snapshot) {
    return false;
  }
  const timestamp = createdAt ?? Date.now();
  const item = {
    id: timestamp,
    createdAt: timestamp,
    name: name && name.trim() ? name.trim() : getDefaultHistoryName(snapshot.mode, timestamp),
    mode: snapshot.mode === 'range' ? 'range' : 'free',
    freeEntries: cloneFreeEntries(snapshot.freeEntries || []),
    rangeEntries: cloneRangeEntries(snapshot.rangeEntries || []),
    rangeConfig: { ...snapshot.rangeConfig },
    rangeWeights: cloneRangeWeights(snapshot.rangeWeights || {})
  };

  state.history = state.history
    .concat(item)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_HISTORY_ITEMS);
  persistHistory();
  renderHistory();
  return true;
};

const persistAutoHistory = () => {
  localStorage.setItem(AUTO_HISTORY_STORAGE_KEY, JSON.stringify(state.autoHistory));
};

const loadAutoHistory = () => {
  try {
    const raw = localStorage.getItem(AUTO_HISTORY_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      state.autoHistory = parsed
        .slice(0, MAX_AUTO_HISTORY_ITEMS)
        .map((entry) => ({
          ...entry,
          mode: entry?.mode || entry?.configuration?.mode || 'free'
        }));
      state.autoHistory.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      if (parsed.length > MAX_AUTO_HISTORY_ITEMS) {
        persistAutoHistory();
      }
    }
  } catch (error) {
    console.error('自動履歴の読み込みに失敗しました', error);
  }
};

const renderAutoHistory = () => {
  if (!dom.autoHistoryList) {
    return;
  }
  dom.autoHistoryList.innerHTML = '';
  if (!state.autoHistory.length) {
    const empty = document.createElement('li');
    empty.className = 'auto-history-empty';
    empty.textContent = '履歴はまだありません。';
    dom.autoHistoryList.append(empty);
    return;
  }

  const entries = state.autoHistory
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_AUTO_HISTORY_ITEMS);

  entries.forEach((entry) => {
      const li = document.createElement('li');
      li.className = 'auto-history-item';
      li.dataset.id = String(entry.id);

      const snapshot = entry.configuration || buildSnapshotFromHistoryItem(entry);
      const labels = getSnapshotLabels(snapshot);
      const modeLabel = getModeLabel((snapshot && snapshot.mode) || entry.mode || state.mode);
      const hasSnapshotData = Boolean(snapshot && labels.length);

      const result = document.createElement('div');
      result.className = 'auto-history-result';
      result.textContent = entry.label ? `結果: ${entry.label}` : '結果: -';

      const summary = document.createElement('div');
      summary.className = 'auto-history-summary';
      summary.textContent = hasSnapshotData
        ? labels.slice(0, 5).join(', ') + (labels.length > 5 ? ' …' : '')
        : '設定情報はありません。';

      const meta = document.createElement('div');
      meta.className = 'auto-history-meta';

      const modeBadge = document.createElement('span');
      modeBadge.className = 'auto-history-mode';
      modeBadge.textContent = modeLabel;

      const time = document.createElement('time');
      if (entry.createdAt) {
        time.dateTime = new Date(entry.createdAt).toISOString();
      }
      time.textContent = formatTimestamp(entry.createdAt) || '日時不明';

      meta.append(modeBadge, time);

      const actions = document.createElement('div');
      actions.className = 'auto-history-actions';

      const loadButton = document.createElement('button');
      loadButton.type = 'button';
      loadButton.className = 'primary';
      loadButton.dataset.autoAction = 'load';
      loadButton.dataset.autoId = String(entry.id);
      loadButton.textContent = '読み込む';
      loadButton.disabled = !hasSnapshotData;

      const saveButton = document.createElement('button');
      saveButton.type = 'button';
      saveButton.dataset.autoAction = 'save';
      saveButton.dataset.autoId = String(entry.id);
      saveButton.textContent = '保存する';
      saveButton.disabled = !hasSnapshotData;

      actions.append(loadButton, saveButton);

      li.append(result, summary, meta, actions);
      dom.autoHistoryList.append(li);
    });
};

const addAutoHistoryEntry = (label) => {
  const createdAt = Date.now();
  const snapshot = captureConfigurationSnapshot();
  const entry = {
    id: `${createdAt}-${Math.random().toString(16).slice(2, 10)}`,
    label,
    mode: snapshot.mode,
    createdAt,
    configuration: snapshot
  };
  state.autoHistory.unshift(entry);
  if (state.autoHistory.length > MAX_AUTO_HISTORY_ITEMS) {
    state.autoHistory = state.autoHistory.slice(0, MAX_AUTO_HISTORY_ITEMS);
  }
  persistAutoHistory();
  renderAutoHistory();
};

const getAutoHistoryEntry = (itemId) =>
  state.autoHistory.find((item) => String(item.id) === String(itemId));

const applyAutoHistoryItem = (itemId) => {
  const entry = getAutoHistoryEntry(itemId);
  const snapshot = entry?.configuration;
  const hasData = snapshot && getSnapshotLabels(snapshot).length;
  if (!entry || !hasData) {
    showToast('読み込める履歴がありません。');
    return;
  }
  applyConfigurationSnapshot(snapshot);
  showToast('履歴の設定を読み込みました。');
};

const saveAutoHistoryItem = (itemId) => {
  const entry = getAutoHistoryEntry(itemId);
  const snapshot = entry?.configuration;
  const hasData = snapshot && getSnapshotLabels(snapshot).length;
  if (!entry || !hasData) {
    showToast('保存できる履歴がありません。');
    return;
  }
  const saved = addHistoryItemFromSnapshot(snapshot, {
    name: entry.label,
    createdAt: entry.createdAt
  });
  if (saved) {
    showToast('履歴を保存済みに追加しました。');
  }
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
  const extraTurns = Math.floor(Math.random() * 6) + 5;
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
    state.currentRotation = normalizeRotation(targetRotation);
    state.isSpinning = false;
    dom.spinButton.disabled = false;
    dom.wheelWrapper.classList.remove('spinning');
    dom.spinResult.textContent = `結果: ${segment.entry.label}`;
    setWheelTransform(state.currentRotation, { immediate: true });
    storeWheelState(state.mode);
    addAutoHistoryEntry(segment.entry.label);
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
    console.error('保存済み設定の読み込みに失敗しました', error);
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
      const titleGroup = document.createElement('div');
      titleGroup.className = 'history-title-group';
      const nameElement = document.createElement('strong');
      nameElement.className = 'history-name';
      nameElement.textContent = item.name || getDefaultHistoryName(item.mode, item.createdAt);
      const modeBadge = document.createElement('span');
      modeBadge.className = 'history-mode-badge';
      modeBadge.textContent = item.mode === 'free' ? '自由入力' : '範囲指定';
      titleGroup.append(nameElement, modeBadge);
      const timeSpan = document.createElement('span');
      timeSpan.className = 'history-time';
      timeSpan.textContent = formatTimestamp(item.createdAt);
      header.append(titleGroup, timeSpan);

      const summary = document.createElement('div');
      summary.className = 'history-summary';
      const labels = item.mode === 'free'
        ? item.freeEntries.filter((entry) => entry.value.trim() !== '').map((entry) => entry.value.trim())
        : item.rangeEntries;
      summary.textContent = labels.slice(0, 5).join(', ') + (labels.length > 5 ? ' …' : '');

      const actions = document.createElement('div');
      actions.className = 'history-actions';
      const renameButton = document.createElement('button');
      renameButton.type = 'button';
      renameButton.className = 'history-rename';
      renameButton.textContent = '名前変更';
      const loadButton = document.createElement('button');
      loadButton.type = 'button';
      loadButton.className = 'history-load';
      loadButton.textContent = '読み込む';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'history-delete';
      deleteButton.textContent = '削除';
      actions.append(renameButton, loadButton, deleteButton);

      li.append(header, summary, actions);
      dom.historyList.append(li);
    });
};

const saveCurrentConfiguration = () => {
  const entries = getActiveEntries();
  if (!entries.length) {
    dom.spinResult.textContent = '保存可能な項目がありません。';
    showToast('保存可能な項目がありません。');
    return;
  }

  const snapshot = captureConfigurationSnapshot();
  const added = addHistoryItemFromSnapshot(snapshot);
  if (added) {
    showToast('現在の設定を保存しました。');
  }
};

const applyHistoryItem = (itemId) => {
  const item = state.history.find((historyItem) => String(historyItem.id) === String(itemId));
  if (!item) return;
  const snapshot = buildSnapshotFromHistoryItem(item);
  applyConfigurationSnapshot(snapshot);
  showToast('保存済み設定を読み込みました。');
};

const deleteHistoryItem = (itemId) => {
  state.history = state.history.filter((item) => String(item.id) !== String(itemId));
  persistHistory();
  renderHistory();
};

const renameHistoryItem = (itemId) => {
  const target = state.history.find((item) => String(item.id) === String(itemId));
  if (!target) {
    return;
  }
  const currentName = target.name || getDefaultHistoryName(target.mode, target.createdAt);
  const nextName = window.prompt('新しい名前を入力してください。', currentName);
  if (nextName === null) {
    return;
  }
  const trimmed = nextName.trim();
  target.name = trimmed || currentName;
  persistHistory();
  renderHistory();
};

const setupHistoryHandlers = () => {
  dom.saveCurrentButtons.forEach((button) => {
    button.addEventListener('click', saveCurrentConfiguration);
  });
  if (dom.clearHistory) {
    dom.clearHistory.addEventListener('click', () => {
      if (!state.history.length) return;
      if (window.confirm('保存済みをすべて削除しますか？')) {
        state.history = [];
        persistHistory();
        renderHistory();
      }
    });
  }

  if (dom.historyList) {
    dom.historyList.addEventListener('click', (event) => {
      const listItem = event.target.closest('.history-item');
      if (!listItem) return;
      const itemId = listItem.dataset.id;
      if (event.target.matches('.history-rename')) {
        renameHistoryItem(itemId);
        return;
      }
      if (event.target.matches('.history-load')) {
        applyHistoryItem(itemId);
      }
      if (event.target.matches('.history-delete')) {
        if (window.confirm('この保存済み設定を削除してもよろしいですか？')) {
          deleteHistoryItem(itemId);
        }
      }
    });
  }
};

const setupAutoHistoryHandlers = () => {
  if (!dom.autoHistoryList) {
    return;
  }
  dom.autoHistoryList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-auto-action]');
    if (!button) return;
    const { autoAction, autoId } = button.dataset;
    if (!autoId || !autoAction) return;
    if (autoAction === 'load') {
      applyAutoHistoryItem(autoId);
      return;
    }
    if (autoAction === 'save') {
      saveAutoHistoryItem(autoId);
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
  setupTabSwitch();
  updateTabUI();
  loadHistory();
  renderHistory();
  loadAutoHistory();
  renderAutoHistory();
  setupHistoryHandlers();
  setupAutoHistoryHandlers();
  initSpin();
  updateWheel();
  applyWheelState(state.mode);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
