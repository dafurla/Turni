(function () {
  'use strict';

  const Scheduler = window.OrariScheduler;
  const Exporter = window.OrariExport;
  const Messaging = window.OrariMessaging;

  const STORAGE_KEY_V4 = 'orari_turni_state_v4';
  const STORAGE_KEY_V3 = 'orari_turni_state_v3';

  const YEAR_RANGE = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032];

  const PALETTE = [
    { dot: '#2563eb', bg: '#eff6ff', border: '#bfdbfe' },
    { dot: '#0d9488', bg: '#f0fdfa', border: '#99f6e4' },
    { dot: '#d97706', bg: '#fffbeb', border: '#fde68a' },
    { dot: '#9333ea', bg: '#faf5ff', border: '#e9d5ff' },
    { dot: '#e11d48', bg: '#fff1f2', border: '#fecdd3' },
    { dot: '#0284c7', bg: '#f0f9ff', border: '#bae6fd' },
    { dot: '#65a30d', bg: '#f7fee7', border: '#d9f99d' },
    { dot: '#ea580c', bg: '#fff7ed', border: '#fed7aa' },
    { dot: '#4f46e5', bg: '#eef2ff', border: '#c7d2fe' },
    { dot: '#db2777', bg: '#fdf2f8', border: '#fbcfe8' },
    { dot: '#059669', bg: '#ecfdf5', border: '#a7f3d0' },
    { dot: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe' }
  ];

  const DEFAULT_WORKERS = [
    { name: 'Bacci Dario', role: 'Operaio', email: '', phone: '' },
    { name: 'Boscolo Luca', role: 'Operaio', email: '', phone: '' },
    { name: 'Bozzato Mattia', role: 'Operaio', email: '', phone: '' },
    { name: 'Nordio Renzo', role: 'Operaio', email: '', phone: '' },
    { name: 'Sassetto Gianluca', role: 'Operaio', email: '', phone: '' }
  ];

  let idCounter = 1;
  function nextId() {
    idCounter += 1;
    return 'w_' + Date.now().toString(36) + '_' + idCounter;
  }

  function makeWorker(data) {
    if (typeof data === 'string') {
      return { id: nextId(), name: data.trim(), role: '', email: '', phone: '', active: true };
    }
    return {
      id: data.id || nextId(),
      name: String(data.name || '').trim(),
      role: String(data.role || '').trim(),
      email: String(data.email || '').trim(),
      phone: String(data.phone || '').trim(),
      active: data.active !== false
    };
  }

  function getMonthKey(year, month) {
    return `${year}-${String(month + 1).padStart(2, '0')}`;
  }

  function detectDefaultViewMode() {
    return window.innerWidth < 768 ? 'mobile' : 'desktop';
  }

  const state = {
    activeTab: 'schedule',
    viewMode: detectDefaultViewMode(), // 'desktop' | 'mobile'
    companyName: 'La Mia Azienda',
    year: 2026,
    month: 10, // Novembre 2026
    workers: DEFAULT_WORKERS.map(makeWorker),
    schedulesByMonth: {},
    options: {
      avoidSameShiftConsecutive: true,
      avoidLateToEarly: true
    },
    highlightedWorkerId: null,
    editingWorkerId: null,
    printMode: 'company', // 'company' | 'worker'
    printWorkerId: 'ALL',
    printIncludeAllDays: true,
    sendWorkerId: null,
    sendCustomMessageDirty: false
  };

  function getCurrentMonthStore() {
    const key = getMonthKey(state.year, state.month);
    if (!state.schedulesByMonth[key]) {
      state.schedulesByMonth[key] = {
        assignments: {},
        locks: {},
        sentLog: {}
      };
    }
    if (!state.schedulesByMonth[key].sentLog) {
      state.schedulesByMonth[key].sentLog = {};
    }
    return state.schedulesByMonth[key];
  }

  // DOM references
  const el = {
    btnModeDesktop: document.getElementById('btnModeDesktop'),
    btnModeMobile: document.getElementById('btnModeMobile'),
    monthSelect: document.getElementById('monthSelect'),
    yearSelect: document.getElementById('yearSelect'),
    generateBtn: document.getElementById('generateBtn'),
    exportXlsxBtn: document.getElementById('exportXlsxBtn'),
    exportCsvBtn: document.getElementById('exportCsvBtn'),

    tabButtons: Array.from(document.querySelectorAll('.tab-btn')),
    tabPanels: {
      create: document.getElementById('tab-create'),
      schedule: document.getElementById('tab-schedule'),
      company: document.getElementById('tab-company'),
      'print-send': document.getElementById('tab-print-send')
    },
    companyTotalBadge: document.getElementById('companyTotalBadge'),

    // Create Turni Wizard Tab
    createMonthSelect: document.getElementById('createMonthSelect'),
    createYearSelect: document.getElementById('createYearSelect'),
    createCalendarInfo: document.getElementById('createCalendarInfo'),
    createAvoidSameShiftOpt: document.getElementById('createAvoidSameShiftOpt'),
    createAvoidLateToEarlyOpt: document.getElementById('createAvoidLateToEarlyOpt'),
    createResetLocksOpt: document.getElementById('createResetLocksOpt'),
    createSelectedCount: document.getElementById('createSelectedCount'),
    createTotalCount: document.getElementById('createTotalCount'),
    createSelectAllBtn: document.getElementById('createSelectAllBtn'),
    createSelectNoneBtn: document.getElementById('createSelectNoneBtn'),
    createWorkerCheckboxes: document.getElementById('createWorkerCheckboxes'),
    createGoCompanyBtn: document.getElementById('createGoCompanyBtn'),
    createGenerateAllBtn: document.getElementById('createGenerateAllBtn'),

    // Sidebar & Schedule Tab
    activeWorkerCount: document.getElementById('activeWorkerCount'),
    sidebarCompanyLabel: document.getElementById('sidebarCompanyLabel'),
    openCompanyTabBtn: document.getElementById('openCompanyTabBtn'),
    openCreateTabBtn: document.getElementById('openCreateTabBtn'),
    addWorkerForm: document.getElementById('addWorkerForm'),
    workerNameInput: document.getElementById('workerNameInput'),
    quickCountInput: document.getElementById('quickCountInput'),
    quickGenBtn: document.getElementById('quickGenBtn'),
    workerList: document.getElementById('workerList'),
    avoidSameShiftOpt: document.getElementById('avoidSameShiftOpt'),
    avoidLateToEarlyOpt: document.getElementById('avoidLateToEarlyOpt'),
    importCsvInput: document.getElementById('importCsvInput'),
    clearLocksBtn: document.getElementById('clearLocksBtn'),
    statusBar: document.getElementById('statusBar'),
    warningsBox: document.getElementById('warningsBox'),
    scheduleTitle: document.getElementById('scheduleTitle'),
    highlightBanner: document.getElementById('highlightBanner'),
    highlightName: document.getElementById('highlightName'),
    clearHighlightBtn: document.getElementById('clearHighlightBtn'),
    scheduleBody: document.getElementById('scheduleBody'),
    mobileScheduleCards: document.getElementById('mobileScheduleCards'),
    summaryHead: document.getElementById('summaryHead'),
    summaryBody: document.getElementById('summaryBody'),
    mobileSummaryCards: document.getElementById('mobileSummaryCards'),

    // Company Roster Tab
    companyNameInput: document.getElementById('companyNameInput'),
    companyAddForm: document.getElementById('companyAddForm'),
    newWorkerName: document.getElementById('newWorkerName'),
    newWorkerRole: document.getElementById('newWorkerRole'),
    newWorkerEmail: document.getElementById('newWorkerEmail'),
    newWorkerPhone: document.getElementById('newWorkerPhone'),
    toggleBulkBtn: document.getElementById('toggleBulkBtn'),
    resetDemoBtn: document.getElementById('resetDemoBtn'),
    clearWorkersBtn: document.getElementById('clearWorkersBtn'),
    bulkPanel: document.getElementById('bulkPanel'),
    bulkTextarea: document.getElementById('bulkTextarea'),
    bulkReplaceBtn: document.getElementById('bulkReplaceBtn'),
    bulkAppendBtn: document.getElementById('bulkAppendBtn'),
    companyTableBody: document.getElementById('companyTableBody'),
    mobileCompanyCards: document.getElementById('mobileCompanyCards'),

    // Print & Send Tab
    executePrintBtn: document.getElementById('executePrintBtn'),
    modeCompanyCard: document.getElementById('modeCompanyCard'),
    modeWorkerCard: document.getElementById('modeWorkerCard'),
    printModeRadios: Array.from(document.querySelectorAll('input[name="printMode"]')),
    workerPrintOptions: document.getElementById('workerPrintOptions'),
    printWorkerSelect: document.getElementById('printWorkerSelect'),
    printIncludeAllDaysOpt: document.getElementById('printIncludeAllDaysOpt'),
    printSheet: document.getElementById('printSheet'),

    sendWorkerSelect: document.getElementById('sendWorkerSelect'),
    sendEmailInput: document.getElementById('sendEmailInput'),
    sendPhoneInput: document.getElementById('sendPhoneInput'),
    sendMessageTextarea: document.getElementById('sendMessageTextarea'),
    resetMessageBtn: document.getElementById('resetMessageBtn'),
    sendEmailBtn: document.getElementById('sendEmailBtn'),
    sendWhatsAppBtn: document.getElementById('sendWhatsAppBtn'),
    copyMessageBtn: document.getElementById('copyMessageBtn'),
    sendRosterStatus: document.getElementById('sendRosterStatus'),

    toast: document.getElementById('toast')
  };

  let toastTimer = null;
  function showToast(msg) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.toast.classList.add('hidden');
    }, 3000);
  }

  function applyViewMode(mode) {
    state.viewMode = mode === 'mobile' ? 'mobile' : 'desktop';
    document.body.classList.toggle('mode-mobile', state.viewMode === 'mobile');
    document.body.classList.toggle('mode-desktop', state.viewMode === 'desktop');
    el.btnModeDesktop.classList.toggle('active', state.viewMode === 'desktop');
    el.btnModeMobile.classList.toggle('active', state.viewMode === 'mobile');
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY_V4, JSON.stringify({
        viewMode: state.viewMode,
        companyName: state.companyName,
        year: state.year,
        month: state.month,
        workers: state.workers,
        schedulesByMonth: state.schedulesByMonth,
        options: state.options
      }));
    } catch (_e) {
      // Ignore storage quota / private mode issues
    }
  }

  function loadState() {
    try {
      const rawV4 = localStorage.getItem(STORAGE_KEY_V4);
      if (rawV4) {
        const parsed = JSON.parse(rawV4);
        if (parsed.viewMode === 'mobile' || parsed.viewMode === 'desktop') {
          state.viewMode = parsed.viewMode;
        }
        if (typeof parsed.companyName === 'string') state.companyName = parsed.companyName;
        if (typeof parsed.year === 'number') state.year = parsed.year;
        if (typeof parsed.month === 'number') state.month = parsed.month;
        if (Array.isArray(parsed.workers)) {
          state.workers = parsed.workers.map(makeWorker);
        }
        if (parsed.schedulesByMonth && typeof parsed.schedulesByMonth === 'object') {
          state.schedulesByMonth = parsed.schedulesByMonth;
        }
        if (parsed.options && typeof parsed.options === 'object') {
          state.options = {
            avoidSameShiftConsecutive: parsed.options.avoidSameShiftConsecutive !== false,
            avoidLateToEarly: parsed.options.avoidLateToEarly !== false
          };
        }
        return true;
      }

      // Migrate from v3 removing Perini Umberto if present
      const rawV3 = localStorage.getItem(STORAGE_KEY_V3);
      if (rawV3) {
        const parsed = JSON.parse(rawV3);
        if (typeof parsed.companyName === 'string') state.companyName = parsed.companyName;
        if (typeof parsed.year === 'number') state.year = parsed.year;
        if (typeof parsed.month === 'number') state.month = parsed.month;
        if (Array.isArray(parsed.workers) && parsed.workers.length > 0) {
          const removedIds = new Set(
            parsed.workers
              .filter((w) => String(w.name || '').trim().toLowerCase() === 'perini umberto')
              .map((w) => w.id)
          );
          state.workers = parsed.workers
            .filter((w) => !removedIds.has(w.id))
            .map(makeWorker);
          if (removedIds.size > 0) {
            state.schedulesByMonth = {};
            return false;
          }
        }
        if (parsed.schedulesByMonth && typeof parsed.schedulesByMonth === 'object') {
          state.schedulesByMonth = parsed.schedulesByMonth;
        }
        if (parsed.options && typeof parsed.options === 'object') {
          state.options = {
            avoidSameShiftConsecutive: parsed.options.avoidSameShiftConsecutive !== false,
            avoidLateToEarly: parsed.options.avoidLateToEarly !== false
          };
        }
        return true;
      }

      return false;
    } catch (_e) {
      return false;
    }
  }

  function getWorkerColor(workerId) {
    const idx = state.workers.findIndex((w) => w.id === workerId);
    if (idx < 0) return PALETTE[0];
    return PALETTE[idx % PALETTE.length];
  }

  function runGeneration() {
    const store = getCurrentMonthStore();
    const result = Scheduler.generateSchedule({
      year: state.year,
      month: state.month,
      workers: state.workers,
      locks: store.locks,
      options: state.options
    });
    store.assignments = result.assignments;
    state.sendCustomMessageDirty = false;
    saveState();
    renderAll();
  }

  function ensureMonthScheduleExists() {
    const store = getCurrentMonthStore();
    if (Object.keys(store.assignments).length === 0 && state.workers.some((w) => w.active !== false)) {
      runGeneration();
    } else {
      renderAll();
    }
  }

  function getCurrentEvaluation() {
    const store = getCurrentMonthStore();
    const calendar = Scheduler.buildMonthCalendar(state.year, state.month);
    const activeWorkers = state.workers.filter((w) => w.active !== false);
    const validation = Scheduler.validateAndSummarize({
      calendar,
      workers: activeWorkers,
      assignments: store.assignments
    });
    return { calendar, activeWorkers, validation, store };
  }

  function setActiveTab(tabName) {
    state.activeTab = tabName;
    el.tabButtons.forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });
    Object.entries(el.tabPanels).forEach(([key, panel]) => {
      panel.classList.toggle('hidden', key !== tabName);
    });
    renderAll();
  }

  function populateMonthYearSelects(monthEl, yearEl) {
    if (monthEl.options.length === 0) {
      Scheduler.MONTH_NAMES_IT.forEach((name, idx) => {
        const opt = document.createElement('option');
        opt.value = String(idx);
        opt.textContent = name;
        monthEl.appendChild(opt);
      });
    }
    const existingYears = new Set(Array.from(yearEl.options).map((o) => Number(o.value)));
    if (yearEl.options.length === 0 || !existingYears.has(state.year)) {
      yearEl.innerHTML = '';
      const years = new Set(YEAR_RANGE);
      years.add(state.year);
      Array.from(years)
        .sort((a, b) => a - b)
        .forEach((y) => {
          const opt = document.createElement('option');
          opt.value = String(y);
          opt.textContent = String(y);
          yearEl.appendChild(opt);
        });
    }
    monthEl.value = String(state.month);
    yearEl.value = String(state.year);
  }

  function renderPeriodControls() {
    populateMonthYearSelects(el.monthSelect, el.yearSelect);
    populateMonthYearSelects(el.createMonthSelect, el.createYearSelect);
    el.avoidSameShiftOpt.checked = state.options.avoidSameShiftConsecutive;
    el.avoidLateToEarlyOpt.checked = state.options.avoidLateToEarly;
    el.createAvoidSameShiftOpt.checked = state.options.avoidSameShiftConsecutive;
    el.createAvoidLateToEarlyOpt.checked = state.options.avoidLateToEarly;
    el.companyTotalBadge.textContent = String(state.workers.length);
    el.sidebarCompanyLabel.textContent = state.companyName ? state.companyName : 'Lista aziendale';
  }

  // TAB 0: CREA TURNI
  function renderCreateTab() {
    const cal = Scheduler.buildMonthCalendar(state.year, state.month);
    let mfDays = 0;
    let satDays = 0;
    let sunDays = 0;
    let totalSlots = 0;
    for (const d of cal.days) {
      if (d.isSunday) sunDays++;
      else if (d.isSaturday) satDays++;
      else mfDays++;
      totalSlots += d.slots.length;
    }

    const totalHours = mfDays * 8 + satDays * 14;
    el.createCalendarInfo.innerHTML =
      `<strong>${escapeHtml(cal.monthName)} ${cal.year}</strong> (${cal.daysInMonth} giorni):<br>` +
      `• ${mfDays} giorni Lun–Ven (${mfDays * 3} turni · ${mfDays * 8}h)<br>` +
      `• ${satDays} Sabati (${satDays * 2} turni · ${satDays * 14}h)<br>` +
      `• ${sunDays} Domeniche festa<br>` +
      `<strong>Totale da coprire: ${totalSlots} turni (${totalHours} ore)</strong>`;

    const activeCount = state.workers.filter((w) => w.active !== false).length;
    el.createSelectedCount.textContent = String(activeCount);
    el.createTotalCount.textContent = String(state.workers.length);

    el.createWorkerCheckboxes.innerHTML = '';
    if (state.workers.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nessun operaio in anagrafica. Aggiungi gli operai nella sezione "Operai".';
      el.createWorkerCheckboxes.appendChild(p);
      return;
    }

    state.workers.forEach((w) => {
      const label = document.createElement('label');
      label.className = 'create-worker-card' + (w.active !== false ? ' checked' : '');

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = w.active !== false;
      chk.addEventListener('change', () => {
        w.active = chk.checked;
        if (!w.active && state.highlightedWorkerId === w.id) {
          state.highlightedWorkerId = null;
        }
        saveState();
        renderAll();
      });

      const meta = document.createElement('div');
      meta.className = 'create-worker-meta';
      const strong = document.createElement('strong');
      strong.textContent = w.name;
      const sub = document.createElement('span');
      sub.textContent = w.role || (w.active !== false ? 'Disponibile' : 'Escluso');
      meta.append(strong, sub);

      label.append(chk, meta);
      el.createWorkerCheckboxes.appendChild(label);
    });
  }

  function renderSidebarWorkers(statsWorkers) {
    const activeCount = state.workers.filter((w) => w.active !== false).length;
    el.activeWorkerCount.textContent = String(activeCount);

    const statsById = new Map((statsWorkers || []).map((st) => [st.id, st]));

    el.workerList.innerHTML = '';
    if (state.workers.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'hint';
      empty.textContent = 'Nessun operaio in anagrafica. Vai su "Operai" o aggiungi qui almeno 3 operai.';
      el.workerList.appendChild(empty);
      return;
    }

    state.workers.forEach((worker) => {
      const color = getWorkerColor(worker.id);
      const item = document.createElement('div');
      item.className = 'worker-item';
      if (worker.active === false) item.classList.add('inactive');
      if (state.highlightedWorkerId === worker.id) item.classList.add('highlighted');

      const left = document.createElement('div');
      left.className = 'worker-left';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = worker.active !== false;
      chk.title = chk.checked
        ? 'Spunta attiva: considerato per i turni. Deseleziona per escluderlo.'
        : 'Spunta disattivata: escluso dai turni. Seleziona per includerlo.';
      chk.addEventListener('change', () => {
        worker.active = chk.checked;
        if (!worker.active && state.highlightedWorkerId === worker.id) {
          state.highlightedWorkerId = null;
        }
        saveState();
        renderAll();
        showToast(
          worker.active
            ? `${worker.name} incluso nei turni.`
            : `${worker.name} escluso dai turni. Clicca "Genera Orario" per aggiornare.`
        );
      });

      const dot = document.createElement('span');
      dot.className = 'worker-dot';
      dot.style.backgroundColor = color.dot;

      if (state.editingWorkerId === worker.id) {
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'inline-input';
        editInput.value = worker.name;
        editInput.setAttribute('aria-label', 'Modifica nome operaio');

        const commitEdit = () => {
          const nextName = editInput.value.trim();
          if (nextName) {
            worker.name = nextName;
            saveState();
          }
          state.editingWorkerId = null;
          renderAll();
        };

        editInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commitEdit();
          } else if (e.key === 'Escape') {
            state.editingWorkerId = null;
            renderAll();
          }
        });

        left.append(chk, dot, editInput);

        const right = document.createElement('div');
        right.className = 'worker-right';

        const saveEditBtn = document.createElement('button');
        saveEditBtn.type = 'button';
        saveEditBtn.className = 'btn btn-primary btn-xs';
        saveEditBtn.textContent = '✓';
        saveEditBtn.title = 'Salva nome';
        saveEditBtn.addEventListener('click', commitEdit);

        const cancelEditBtn = document.createElement('button');
        cancelEditBtn.type = 'button';
        cancelEditBtn.className = 'btn btn-ghost btn-xs';
        cancelEditBtn.textContent = '✕';
        cancelEditBtn.title = 'Annulla modifica';
        cancelEditBtn.addEventListener('click', () => {
          state.editingWorkerId = null;
          renderAll();
        });

        right.append(saveEditBtn, cancelEditBtn);
        item.append(left, right);
        el.workerList.appendChild(item);
        setTimeout(() => {
          editInput.focus();
          editInput.select();
        }, 0);
        return;
      }

      const nameBtn = document.createElement('button');
      nameBtn.type = 'button';
      nameBtn.className = 'worker-name-btn';
      nameBtn.textContent = worker.name;
      nameBtn.title = 'Clicca per evidenziare i turni di ' + worker.name;
      nameBtn.addEventListener('click', () => {
        state.highlightedWorkerId =
          state.highlightedWorkerId === worker.id ? null : worker.id;
        renderAll();
      });

      left.append(chk, dot, nameBtn);

      const right = document.createElement('div');
      right.className = 'worker-right';

      const st = statsById.get(worker.id);
      const shiftsCount = st ? st.totalShifts : 0;
      const hoursCount = st ? st.totalHours : 0;
      const badge = document.createElement('span');
      badge.className = 'worker-count-pill';
      badge.textContent = `${shiftsCount}t · ${hoursCount}h`;

      const editBtn = document.createElement('button');
      editBtn.type = 'button';
      editBtn.className = 'icon-btn';
      editBtn.textContent = '✏️';
      editBtn.title = 'Modifica nome operaio';
      editBtn.addEventListener('click', () => {
        state.editingWorkerId = worker.id;
        renderAll();
      });

      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'remove-btn';
      removeBtn.textContent = '×';
      removeBtn.title = 'Elimina operaio';
      removeBtn.addEventListener('click', () => {
        removeWorkerById(worker.id);
      });

      right.append(badge, editBtn, removeBtn);
      item.append(left, right);
      el.workerList.appendChild(item);
    });
  }

  function removeWorkerById(workerId) {
    state.workers = state.workers.filter((w) => w.id !== workerId);
    for (const monthStore of Object.values(state.schedulesByMonth)) {
      if (monthStore.assignments) {
        for (const k of Object.keys(monthStore.assignments)) {
          if (monthStore.assignments[k] === workerId) delete monthStore.assignments[k];
        }
      }
      if (monthStore.locks) {
        for (const k of Object.keys(monthStore.locks)) {
          if (monthStore.locks[k] === workerId) delete monthStore.locks[k];
        }
      }
    }
    if (state.highlightedWorkerId === workerId) state.highlightedWorkerId = null;
    if (state.sendWorkerId === workerId) state.sendWorkerId = null;
    if (state.printWorkerId === workerId) state.printWorkerId = 'ALL';
    saveState();
    renderAll();
  }

  function renderStatusAndWarnings(evaluation) {
    const { activeWorkers, validation } = evaluation;
    const { checks, stats } = validation;

    el.statusBar.innerHTML = '';

    const pills = [];
    pills.push({
      cls: checks.noSameDayDoubleShift ? 'ok' : 'err',
      text: checks.noSameDayDoubleShift
        ? '✓ Max 1 turno al giorno'
        : `✕ ${checks.sameDayConflicts.length} doppi turni`
    });

    if (activeWorkers.length >= 3 && activeWorkers.length <= 17) {
      pills.push({
        cls: checks.allWorkersWeeklyMin ? 'ok' : 'warn',
        text: checks.allWorkersWeeklyMin
          ? '✓ Min 1 turno/settimana'
          : `⚠ ${checks.weeklyFailures.length} settimane sotto minimo`
      });
    } else if (activeWorkers.length > 17) {
      pills.push({
        cls: 'warn',
        text: `⚠ ${activeWorkers.length} operai > 17 turni/sett.`
      });
    } else {
      pills.push({
        cls: 'err',
        text: `✕ Servono >= 3 operai (attuali: ${activeWorkers.length})`
      });
    }

    pills.push({
      cls: checks.allSlotsFilled ? 'ok' : 'warn',
      text: `Coperti: ${checks.filledSlots}/${checks.totalSlots}`
    });

    if (activeWorkers.length > 0) {
      pills.push({
        cls: 'neutral',
        text: `A testa: ${stats.minShifts}–${stats.maxShifts} turni`
      });
      const hoursOk = stats.hoursDiff <= 2;
      pills.push({
        cls: hoursOk ? 'ok' : 'warn',
        text: `Ore mensili: ${stats.minHours}–${stats.maxHours}h (diff. ${stats.hoursDiff}h)`
      });
    }

    pills.forEach((p) => {
      const span = document.createElement('span');
      span.className = `status-pill ${p.cls}`;
      span.textContent = p.text;
      el.statusBar.appendChild(span);
    });

    const combinedWarnings = [];
    if (activeWorkers.length > 0 && activeWorkers.length < 3) {
      combinedWarnings.push('Servono almeno 3 operai attivi per coprire i 3 turni Lun–Ven senza doppi turni giornalieri.');
    }
    if (activeWorkers.length > 17) {
      combinedWarnings.push(`Con ${activeWorkers.length} operai attivi, una settimana da 17 turni non basta per dare 1 turno a tutti ogni settimana.`);
    }
    for (const w of validation.warnings) {
      if (!combinedWarnings.includes(w)) combinedWarnings.push(w);
    }
    for (const note of checks.partialWeekNotes) {
      combinedWarnings.push('Nota settimana parziale di inizio/fine mese — ' + note);
    }

    const inactiveAssignedNames = new Set();
    const inactiveWorkerMap = new Map(
      state.workers.filter((w) => w.active === false).map((w) => [w.id, w.name])
    );
    for (const wId of Object.values(evaluation.store.assignments || {})) {
      if (inactiveWorkerMap.has(wId)) {
        inactiveAssignedNames.add(inactiveWorkerMap.get(wId));
      }
    }
    if (inactiveAssignedNames.size > 0) {
      combinedWarnings.push(
        `Dipendenti senza spunta ancora presenti in tabella (${Array.from(inactiveAssignedNames).join(', ')}): clicca "Genera Orario" o sostituiscili dal menu a tendina.`
      );
    }

    if (combinedWarnings.length > 0) {
      el.warningsBox.classList.remove('hidden');
      el.warningsBox.innerHTML = '';
      const ul = document.createElement('ul');
      combinedWarnings.forEach((msg) => {
        const li = document.createElement('li');
        li.textContent = msg;
        ul.appendChild(li);
      });
      el.warningsBox.appendChild(ul);
    } else {
      el.warningsBox.classList.add('hidden');
      el.warningsBox.innerHTML = '';
    }
  }

  function createSlotControl(dayObj, slot, sameDayWorkerSet, conflictWorkerIds, store) {
    const key = `${dayObj.day}:${slot.slotKey}`;
    const assignedId = store.assignments[key] || '';
    const isLocked = Boolean(store.locks[key]);

    const select = document.createElement('select');
    select.className = 'slot-select';

    const emptyOpt = document.createElement('option');
    emptyOpt.value = '';
    emptyOpt.textContent = '— Non assegnato —';
    select.appendChild(emptyOpt);

    const activeWorkers = state.workers.filter((w) => w.active !== false);
    const availableWorkers = activeWorkers.filter(
      (w) => !sameDayWorkerSet.has(w.id) || w.id === assignedId
    );
    const busyWorkers = activeWorkers.filter(
      (w) => sameDayWorkerSet.has(w.id) && w.id !== assignedId
    );

    if (assignedId && !activeWorkers.some((w) => w.id === assignedId)) {
      const inactiveAssigned = state.workers.find((w) => w.id === assignedId);
      if (inactiveAssigned) {
        const currentOpt = document.createElement('option');
        currentOpt.value = inactiveAssigned.id;
        currentOpt.textContent = `${inactiveAssigned.name} (spunta disattivata)`;
        select.appendChild(currentOpt);
      }
    }

    if (availableWorkers.length > 0) {
      const availGroup = document.createElement('optgroup');
      availGroup.label = 'Operai disponibili per il turno';
      availableWorkers.forEach((w) => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.name;
        availGroup.appendChild(opt);
      });
      select.appendChild(availGroup);
    }

    if (busyWorkers.length > 0) {
      const busyGroup = document.createElement('optgroup');
      busyGroup.label = 'Già in turno oggi (non disponibili)';
      busyWorkers.forEach((w) => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.name} (già in turno oggi)`;
        opt.disabled = true;
        busyGroup.appendChild(opt);
      });
      select.appendChild(busyGroup);
    }

    select.value = assignedId;

    if (assignedId) {
      const color = getWorkerColor(assignedId);
      select.style.backgroundColor = color.bg;
      select.style.borderColor = color.border;
    }

    if (conflictWorkerIds.has(assignedId)) {
      select.classList.add('is-conflict');
    }

    if (state.highlightedWorkerId) {
      if (assignedId === state.highlightedWorkerId) {
        select.classList.add('is-highlighted');
      } else {
        select.classList.add('is-dimmed');
      }
    }

    select.addEventListener('change', () => {
      const val = select.value;
      if (val) {
        store.assignments[key] = val;
        if (store.locks[key]) store.locks[key] = val;
      } else {
        delete store.assignments[key];
        delete store.locks[key];
      }
      state.sendCustomMessageDirty = false;
      saveState();
      renderAll();
    });

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'lock-btn' + (isLocked ? ' locked' : '');
    lockBtn.textContent = isLocked ? '🔒' : '🔓';
    lockBtn.title = isLocked
      ? 'Turno bloccato: non verrà cambiato rigenerando. Clicca per sbloccare.'
      : 'Clicca per bloccare questo turno prima di rigenerare.';
    lockBtn.addEventListener('click', () => {
      if (store.locks[key]) {
        delete store.locks[key];
      } else if (store.assignments[key]) {
        store.locks[key] = store.assignments[key];
      } else {
        showToast('Assegna prima un operaio per poter bloccare il turno.');
        return;
      }
      saveState();
      renderAll();
    });

    return { select, lockBtn };
  }

  function buildSlotCell(dayObj, slot, sameDayWorkerSet, conflictWorkerIds, store) {
    const td = document.createElement('td');
    td.className = 'slot-cell';

    const wrap = document.createElement('div');
    wrap.className = 'slot-inner';

    if (dayObj.isSaturday) {
      const tag = document.createElement('span');
      tag.className = 'slot-time-tag';
      tag.textContent = slot.label;
      wrap.appendChild(tag);
    }

    const { select, lockBtn } = createSlotControl(dayObj, slot, sameDayWorkerSet, conflictWorkerIds, store);
    wrap.append(select, lockBtn);
    td.appendChild(wrap);
    return td;
  }

  function renderScheduleTable(evaluation) {
    const { calendar, validation, store } = evaluation;
    el.scheduleTitle.textContent = `Orario mese: ${calendar.monthName} ${calendar.year}`;

    if (state.highlightedWorkerId) {
      const hw = state.workers.find((w) => w.id === state.highlightedWorkerId);
      if (hw) {
        el.highlightName.textContent = hw.name;
        el.highlightBanner.classList.remove('hidden');
      } else {
        el.highlightBanner.classList.add('hidden');
      }
    } else {
      el.highlightBanner.classList.add('hidden');
    }

    const conflictsByDay = new Map();
    for (const c of validation.checks.sameDayConflicts) {
      if (!conflictsByDay.has(c.day)) conflictsByDay.set(c.day, new Set());
      conflictsByDay.get(c.day).add(c.workerId);
    }

    // 1. Desktop table
    el.scheduleBody.innerHTML = '';
    // 2. Smartphone cards
    el.mobileScheduleCards.innerHTML = '';

    let lastWeekIndex = -1;

    for (const dayObj of calendar.days) {
      if (dayObj.weekIndex !== lastWeekIndex) {
        lastWeekIndex = dayObj.weekIndex;
        const weekMeta = calendar.weeks[dayObj.weekIndex];
        const weekLabel = `Settimana ${dayObj.weekIndex + 1} · Giorni ${weekMeta.startDay}–${weekMeta.endDay} (${weekMeta.totalSlots} turni)`;

        const divTr = document.createElement('tr');
        divTr.className = 'week-divider';
        const divTd = document.createElement('td');
        divTd.colSpan = 4;
        divTd.textContent = weekLabel;
        divTr.appendChild(divTd);
        el.scheduleBody.appendChild(divTr);

        const mobileWeek = document.createElement('div');
        mobileWeek.className = 'mobile-week-heading';
        mobileWeek.textContent = weekLabel;
        el.mobileScheduleCards.appendChild(mobileWeek);
      }

      const tr = document.createElement('tr');
      if (dayObj.isSaturday) tr.className = 'row-sat';
      if (dayObj.isSunday) tr.className = 'row-sun';

      const dayTd = document.createElement('td');
      const dayDiv = document.createElement('div');
      dayDiv.className = 'day-cell';
      const numSpan = document.createElement('span');
      numSpan.className = 'day-num';
      numSpan.textContent = String(dayObj.day);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = dayObj.dayNameShort;
      dayDiv.append(numSpan, nameSpan);
      dayTd.appendChild(dayDiv);
      tr.appendChild(dayTd);

      const mCard = document.createElement('div');
      mCard.className = 'mobile-day-card' + (dayObj.isSaturday ? ' is-sat' : '') + (dayObj.isSunday ? ' is-sun' : '');
      const mHeader = document.createElement('div');
      mHeader.className = 'mobile-day-header';
      mHeader.innerHTML = `<span>${escapeHtml(dayObj.dayNameFull)} ${String(dayObj.day).padStart(2, '0')} ${escapeHtml(calendar.monthName)}</span>`;

      if (dayObj.isSunday) {
        const sunTd = document.createElement('td');
        sunTd.colSpan = 3;
        sunTd.className = 'sun-holiday';
        sunTd.textContent = '🌴 FESTA — Domenica (Riposo)';
        tr.appendChild(sunTd);

        const badge = document.createElement('span');
        badge.textContent = '🌴 FESTA';
        mHeader.appendChild(badge);
        mCard.appendChild(mHeader);
      } else {
        const sameDayWorkers = new Set();
        for (const s of dayObj.slots) {
          const wId = store.assignments[`${dayObj.day}:${s.slotKey}`];
          if (wId) sameDayWorkers.add(wId);
        }
        const dayConflicts = conflictsByDay.get(dayObj.day) || new Set();

        if (dayObj.isSaturday) {
          tr.appendChild(buildSlotCell(dayObj, dayObj.slots[0], sameDayWorkers, dayConflicts, store));
          tr.appendChild(buildSlotCell(dayObj, dayObj.slots[1], sameDayWorkers, dayConflicts, store));
          const closedTd = document.createElement('td');
          closedTd.className = 'sat-closed';
          closedTd.textContent = '— (Sabato: 2 turni)';
          tr.appendChild(closedTd);
        } else {
          tr.appendChild(buildSlotCell(dayObj, dayObj.slots[0], sameDayWorkers, dayConflicts, store));
          tr.appendChild(buildSlotCell(dayObj, dayObj.slots[1], sameDayWorkers, dayConflicts, store));
          tr.appendChild(buildSlotCell(dayObj, dayObj.slots[2], sameDayWorkerSetSafe(sameDayWorkers), dayConflicts, store));
        }

        const mTypeBadge = document.createElement('span');
        mTypeBadge.className = 'mini-tag';
        mTypeBadge.textContent = dayObj.isSaturday ? 'Sabato (2 turni)' : '3 turni';
        mHeader.appendChild(mTypeBadge);
        mCard.appendChild(mHeader);

        const mSlots = document.createElement('div');
        mSlots.className = 'mobile-day-slots';
        for (const slot of dayObj.slots) {
          const sRow = document.createElement('div');
          sRow.className = 'mobile-slot-row';
          const sLbl = document.createElement('div');
          sLbl.className = 'mobile-slot-label';
          sLbl.textContent = `Turno ${slot.label} (${slot.hours}h)`;
          const sCtrl = document.createElement('div');
          sCtrl.className = 'mobile-slot-control';
          const { select, lockBtn } = createSlotControl(dayObj, slot, sameDayWorkers, dayConflicts, store);
          sCtrl.append(select, lockBtn);
          sRow.append(sLbl, sCtrl);
          mSlots.appendChild(sRow);
        }
        mCard.appendChild(mSlots);
      }

      el.scheduleBody.appendChild(tr);
      el.mobileScheduleCards.appendChild(mCard);
    }
  }

  function sameDayWorkerSetSafe(s) {
    return s;
  }

  function renderSummaryTable(evaluation) {
    const { calendar, validation } = evaluation;
    const workers = validation.stats.workers;

    el.summaryHead.innerHTML = '';
    const headTr = document.createElement('tr');
    const fixedCols = [
      'Operaio',
      'Turni Mese',
      'Ore Totali',
      '06-08',
      '14-16',
      '16-20',
      'Sab 06-13',
      'Sab 13-20'
    ];
    fixedCols.forEach((label, idx) => {
      const th = document.createElement('th');
      th.textContent = label;
      if (idx > 0) th.className = 'num';
      headTr.appendChild(th);
    });
    calendar.weeks.forEach((w) => {
      if (w.totalSlots === 0) return;
      const th = document.createElement('th');
      th.className = 'num';
      th.textContent = `Sett. ${w.weekIndex + 1}`;
      th.title = `Giorni ${w.startDay}–${w.endDay} (${w.totalSlots} turni)`;
      headTr.appendChild(th);
    });
    el.summaryHead.appendChild(headTr);

    el.summaryBody.innerHTML = '';
    el.mobileSummaryCards.innerHTML = '';

    if (workers.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = fixedCols.length + calendar.weeks.length;
      td.textContent = 'Nessun operaio attivo.';
      tr.appendChild(td);
      el.summaryBody.appendChild(tr);

      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nessun operaio attivo.';
      el.mobileSummaryCards.appendChild(p);
      return;
    }

    workers.forEach((st) => {
      const tr = document.createElement('tr');
      const color = getWorkerColor(st.id);

      const nameTd = document.createElement('td');
      const nameWrap = document.createElement('span');
      nameWrap.className = 'summary-worker';
      const dot = document.createElement('span');
      dot.className = 'worker-dot';
      dot.style.backgroundColor = color.dot;
      const txt = document.createElement('span');
      txt.textContent = st.name;
      nameWrap.append(dot, txt);
      nameTd.appendChild(nameWrap);
      tr.appendChild(nameTd);

      const numVals = [
        st.totalShifts,
        `${st.totalHours}h`,
        st.bySlot.mf_1,
        st.bySlot.mf_2,
        st.bySlot.mf_3,
        st.bySlot.sat_1,
        st.bySlot.sat_2
      ];
      numVals.forEach((v) => {
        const td = document.createElement('td');
        td.className = 'num';
        td.textContent = String(v);
        tr.appendChild(td);
      });

      calendar.weeks.forEach((w) => {
        if (w.totalSlots === 0) return;
        const td = document.createElement('td');
        td.className = 'num';
        const cnt = st.byWeek[w.weekIndex];
        if (cnt === 0 && w.totalSlots >= workers.length) {
          const span = document.createElement('span');
          span.className = 'badge-zero';
          span.textContent = '0';
          td.appendChild(span);
        } else {
          td.textContent = String(cnt);
        }
        tr.appendChild(td);
      });

      el.summaryBody.appendChild(tr);

      // Mobile summary card
      const mSum = document.createElement('div');
      mSum.className = 'mobile-summary-card';
      mSum.innerHTML = `
        <div class="mobile-summary-top">
          <span class="summary-worker">
            <span class="worker-dot" style="background-color:${color.dot}"></span>
            <span>${escapeHtml(st.name)}</span>
          </span>
          <span>${st.totalShifts} turni · ${st.totalHours}h</span>
        </div>
        <div class="mobile-summary-pills">
          <span class="mini-tag">06-08: ${st.bySlot.mf_1}</span>
          <span class="mini-tag">14-16: ${st.bySlot.mf_2}</span>
          <span class="mini-tag">16-20: ${st.bySlot.mf_3}</span>
          <span class="mini-tag">Sab 06-13: ${st.bySlot.sat_1}</span>
          <span class="mini-tag">Sab 13-20: ${st.bySlot.sat_2}</span>
        </div>
      `;
      el.mobileSummaryCards.appendChild(mSum);
    });
  }

  // TAB 2: LISTA OPERAI AZIENDA
  function renderCompanyTab(evaluation) {
    el.companyNameInput.value = state.companyName;

    const statsById = new Map(
      (evaluation.validation.stats.workers || []).map((st) => [st.id, st])
    );

    el.companyTableBody.innerHTML = '';
    el.mobileCompanyCards.innerHTML = '';

    if (state.workers.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 7;
      td.textContent = 'Nessun operaio registrato in azienda. Compila il modulo qui sopra per aggiungere i lavoratori.';
      tr.appendChild(td);
      el.companyTableBody.appendChild(tr);

      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nessun operaio registrato in azienda.';
      el.mobileCompanyCards.appendChild(p);
      return;
    }

    const bindFieldInput = (worker, field, type, placeholder) => {
      const input = document.createElement('input');
      input.type = type;
      input.className = 'inline-input';
      input.value = worker[field] || '';
      input.placeholder = placeholder;
      input.addEventListener('input', () => {
        const nextVal = input.value.trim();
        if (field === 'name' && !nextVal) return;
        worker[field] = nextVal;
        saveState();
      });
      input.addEventListener('change', () => {
        const nextVal = input.value.trim();
        if (field === 'name' && !nextVal) {
          input.value = worker.name;
          showToast('Il nome non può essere vuoto.');
          return;
        }
        worker[field] = nextVal;
        saveState();
        // Refresh other panels without destroying the company table while clicking buttons
        const ev = getCurrentEvaluation();
        renderCreateTab();
        renderSidebarWorkers(ev.validation.stats.workers);
        renderScheduleTable(ev);
        renderSummaryTable(ev);
        renderPrintAndSendTab(ev);
      });
      return input;
    };

    state.workers.forEach((worker) => {
      const tr = document.createElement('tr');

      const activeTd = document.createElement('td');
      activeTd.className = 'num';
      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = worker.active !== false;
      chk.addEventListener('change', () => {
        worker.active = chk.checked;
        saveState();
        renderAll();
      });
      activeTd.appendChild(chk);
      tr.appendChild(activeTd);

      const tdName = document.createElement('td');
      tdName.appendChild(bindFieldInput(worker, 'name', 'text', 'Nome e Cognome'));
      const tdRole = document.createElement('td');
      tdRole.appendChild(bindFieldInput(worker, 'role', 'text', 'Ruolo'));
      const tdEmail = document.createElement('td');
      tdEmail.appendChild(bindFieldInput(worker, 'email', 'email', 'email@azienda.it'));
      const tdPhone = document.createElement('td');
      tdPhone.appendChild(bindFieldInput(worker, 'phone', 'tel', '+39 333 ...'));
      tr.append(tdName, tdRole, tdEmail, tdPhone);

      const st = statsById.get(worker.id);
      const shiftsCount = st ? st.totalShifts : 0;
      const hoursCount = st ? st.totalHours : 0;
      const countTd = document.createElement('td');
      countTd.className = 'num';
      countTd.textContent = `${shiftsCount}t · ${hoursCount}h`;
      tr.appendChild(countTd);

      const actionsTd = document.createElement('td');
      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'row-actions';

      const makeActionBtns = () => {
        const printBtn = document.createElement('button');
        printBtn.type = 'button';
        printBtn.className = 'btn btn-ghost btn-xs';
        printBtn.textContent = '🖨️ Turni';
        printBtn.addEventListener('click', () => {
          state.printMode = 'worker';
          state.printWorkerId = worker.id;
          setActiveTab('print-send');
        });

        const sendBtn = document.createElement('button');
        sendBtn.type = 'button';
        sendBtn.className = 'btn btn-ghost btn-xs';
        sendBtn.textContent = '📤 Invia';
        sendBtn.addEventListener('click', () => {
          state.sendWorkerId = worker.id;
          state.sendCustomMessageDirty = false;
          setActiveTab('print-send');
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'btn btn-ghost btn-xs';
        delBtn.textContent = '🗑️';
        delBtn.title = 'Elimina operaio dall’azienda';
        delBtn.addEventListener('click', () => {
          removeWorkerById(worker.id);
        });
        return [printBtn, sendBtn, delBtn];
      };

      actionsWrap.append(...makeActionBtns());
      actionsTd.appendChild(actionsWrap);
      tr.appendChild(actionsTd);
      el.companyTableBody.appendChild(tr);

      // Mobile Company Card
      const mCard = document.createElement('div');
      mCard.className = 'mobile-company-card';

      const topRow = document.createElement('div');
      topRow.className = 'mobile-summary-top';
      const activeLbl = document.createElement('label');
      activeLbl.className = 'checkbox-row';
      activeLbl.style.marginBottom = '0';
      const mChk = document.createElement('input');
      mChk.type = 'checkbox';
      mChk.checked = worker.active !== false;
      mChk.addEventListener('change', () => {
        worker.active = mChk.checked;
        saveState();
        renderAll();
      });
      const mTitle = document.createElement('strong');
      mTitle.textContent = 'Attivo nei turni';
      activeLbl.append(mChk, mTitle);

      const mCnt = document.createElement('span');
      mCnt.className = 'mini-tag';
      mCnt.textContent = `${shiftsCount}t · ${hoursCount}h`;
      topRow.append(activeLbl, mCnt);

      const fieldsDiv = document.createElement('div');
      fieldsDiv.className = 'mobile-company-fields';
      const wrapField = (lblText, inputEl) => {
        const fg = document.createElement('div');
        fg.className = 'field-group';
        const l = document.createElement('label');
        l.textContent = lblText;
        fg.append(l, inputEl);
        return fg;
      };
      fieldsDiv.append(
        wrapField('Nome e Cognome', bindFieldInput(worker, 'name', 'text', 'Nome e Cognome')),
        wrapField('Ruolo / Reparto', bindFieldInput(worker, 'role', 'text', 'Ruolo')),
        wrapField('Email', bindFieldInput(worker, 'email', 'email', 'email@azienda.it')),
        wrapField('WhatsApp / Telefono', bindFieldInput(worker, 'phone', 'tel', '+39 333 ...'))
      );

      const mActions = document.createElement('div');
      mActions.className = 'mobile-company-actions';
      mActions.append(...makeActionBtns());

      mCard.append(topRow, fieldsDiv, mActions);
      el.mobileCompanyCards.appendChild(mCard);
    });
  }

  // TAB 3: STAMPA & INVIA TURNI
  function buildCompanyPrintPage(calendar, store, evaluation) {
    const workerMap = new Map(state.workers.map((w) => [w.id, w.name]));
    const page = document.createElement('div');
    page.className = 'print-page';

    const header = document.createElement('div');
    header.className = 'print-header';
    header.innerHTML = `
      <div>
        <h3>${escapeHtml(state.companyName || 'Orario Turni Aziendale')}</h3>
        <p>Prospetto Completo Turni Azienda — ${escapeHtml(calendar.monthName)} ${calendar.year}</p>
      </div>
      <div class="print-badge-box">
        <strong>Stampa Turni Azienda</strong>
        <span>${evaluation.activeWorkers.length} operai attivi · ${evaluation.validation.checks.totalSlots} turni</span>
      </div>
    `;
    page.appendChild(header);

    const table = document.createElement('table');
    table.className = 'print-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>Giorno</th>
          <th>06:00 / 08:00 (Sab 06:00 / 13:00)</th>
          <th>14:00 / 16:00 (Sab 13:00 / 20:00)</th>
          <th>16:00 / 20:00</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement('tbody');

    for (const dayObj of calendar.days) {
      const tr = document.createElement('tr');
      if (dayObj.isSunday) tr.className = 'is-sun';
      if (dayObj.isSaturday) tr.className = 'is-sat';

      const dayLabel = `${String(dayObj.day).padStart(2, '0')} ${dayObj.dayNameShort}`;
      if (dayObj.isSunday) {
        tr.innerHTML = `<td class="print-day-col"><strong>${dayLabel}</strong></td><td colspan="3" class="print-sun-cell">FESTA (Domenica — Riposo)</td>`;
      } else if (dayObj.isSaturday) {
        const w1 = workerMap.get(store.assignments[`${dayObj.day}:sat_1`]) || '—';
        const w2 = workerMap.get(store.assignments[`${dayObj.day}:sat_2`]) || '—';
        tr.innerHTML = `
          <td class="print-day-col"><strong>${dayLabel}</strong></td>
          <td><strong class="print-worker-name">${escapeHtml(w1)}</strong> <small class="print-sat-hours">(06-13)</small></td>
          <td><strong class="print-worker-name">${escapeHtml(w2)}</strong> <small class="print-sat-hours">(13-20)</small></td>
          <td class="print-empty-col">—</td>
        `;
      } else {
        const w1 = workerMap.get(store.assignments[`${dayObj.day}:mf_1`]) || '—';
        const w2 = workerMap.get(store.assignments[`${dayObj.day}:mf_2`]) || '—';
        const w3 = workerMap.get(store.assignments[`${dayObj.day}:mf_3`]) || '—';
        tr.innerHTML = `
          <td class="print-day-col"><strong>${dayLabel}</strong></td>
          <td><strong class="print-worker-name">${escapeHtml(w1)}</strong></td>
          <td><strong class="print-worker-name">${escapeHtml(w2)}</strong></td>
          <td><strong class="print-worker-name">${escapeHtml(w3)}</strong></td>
        `;
      }
      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    page.appendChild(table);

    if (evaluation.validation.stats.workers.length > 0) {
      const footer = document.createElement('div');
      footer.className = 'print-footer-summary';
      footer.innerHTML = evaluation.validation.stats.workers
        .map((st) => `<span><strong class="print-worker-name">${escapeHtml(st.name)}</strong>: ${st.totalShifts} turni (${st.totalHours}h)</span>`)
        .join('');
      page.appendChild(footer);
    }

    return page;
  }

  function buildSingleWorkerPrintPage(calendar, store, worker, addPageBreak) {
    const summary = Messaging.extractWorkerShiftsForMonth({
      calendar,
      worker,
      assignments: store.assignments
    });

    const page = document.createElement('div');
    page.className = 'print-page' + (addPageBreak ? ' print-page-break' : '');

    const header = document.createElement('div');
    header.className = 'print-header';
    const roleLine = worker.role ? ` · ${escapeHtml(worker.role)}` : '';
    const contactLine = [worker.email, worker.phone].filter(Boolean).map(escapeHtml).join(' · ');
    header.innerHTML = `
      <div>
        <h3>${escapeHtml(state.companyName || 'Azienda')} — Scheda Turni: <span class="print-worker-hero">${escapeHtml(worker.name)}</span></h3>
        <p><strong class="print-worker-name">${escapeHtml(worker.name)}</strong>${roleLine}${contactLine ? ' · ' + contactLine : ''}</p>
      </div>
      <div class="print-badge-box">
        <strong>${escapeHtml(calendar.monthName)} ${calendar.year}</strong>
        <span>${summary.totalShifts} turni · ${summary.totalHours} ore totali</span>
      </div>
    `;
    page.appendChild(header);

    const rowsToShow = state.printIncludeAllDays ? summary.entries : summary.workingDays;
    const table = document.createElement('table');
    table.className = 'print-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th style="width: 110px;">Data</th>
          <th style="width: 120px;">Giorno</th>
          <th>Fascia Oraria</th>
          <th style="width: 80px;">Ore</th>
        </tr>
      </thead>
    `;
    const tbody = document.createElement('tbody');

    if (rowsToShow.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td colspan="4">Nessun turno assegnato per questo mese.</td>';
      tbody.appendChild(tr);
    } else {
      for (const item of rowsToShow) {
        const tr = document.createElement('tr');
        if (item.isSunday) tr.className = 'is-sun';
        else if (item.slot) tr.className = 'is-working';
        else if (item.isSaturday) tr.className = 'is-sat';

        const dateLabel = `${String(item.day).padStart(2, '0')} ${calendar.monthName}`;
        let shiftHtml = 'Riposo';
        let hoursText = '—';
        if (item.isSunday) {
          shiftHtml = 'FESTA (Domenica)';
        } else if (item.slot) {
          shiftHtml = `<strong class="print-worker-name">TURNO ${escapeHtml(item.slot.label)}</strong>`;
          hoursText = `${item.slot.hours}h`;
        }

        tr.innerHTML = `
          <td><strong>${escapeHtml(dateLabel)}</strong></td>
          <td>${escapeHtml(item.dayNameFull)}</td>
          <td>${shiftHtml}</td>
          <td><strong>${escapeHtml(hoursText)}</strong></td>
        `;
        tbody.appendChild(tr);
      }
    }

    table.appendChild(tbody);
    page.appendChild(table);

    const footer = document.createElement('div');
    footer.className = 'print-footer-summary';
    footer.innerHTML = `
      <span><strong>Totale turni nel mese:</strong> ${summary.totalShifts}</span>
      <span><strong>Totale ore nel mese:</strong> ${summary.totalHours}h</span>
    `;
    page.appendChild(footer);
    return page;
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPrintAndSendTab(evaluation) {
    const { calendar, store } = evaluation;

    el.modeCompanyCard.classList.toggle('selected', state.printMode === 'company');
    el.modeWorkerCard.classList.toggle('selected', state.printMode === 'worker');
    el.printModeRadios.forEach((r) => {
      r.checked = r.value === state.printMode;
    });
    el.workerPrintOptions.classList.toggle('hidden', state.printMode !== 'worker');
    el.printIncludeAllDaysOpt.checked = state.printIncludeAllDays;

    el.printWorkerSelect.innerHTML = '';
    const allOpt = document.createElement('option');
    allOpt.value = 'ALL';
    allOpt.textContent = 'Tutti gli operai attivi (1 scheda per pagina)';
    el.printWorkerSelect.appendChild(allOpt);
    state.workers.forEach((w) => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = w.active === false ? `${w.name} (non attivo)` : w.name;
      el.printWorkerSelect.appendChild(opt);
    });
    if (
      state.printWorkerId !== 'ALL' &&
      !state.workers.some((w) => w.id === state.printWorkerId)
    ) {
      state.printWorkerId = 'ALL';
    }
    el.printWorkerSelect.value = state.printWorkerId;

    el.printSheet.innerHTML = '';
    if (state.printMode === 'company') {
      el.printSheet.appendChild(buildCompanyPrintPage(calendar, store, evaluation));
    } else {
      const targets =
        state.printWorkerId === 'ALL'
          ? state.workers.filter((w) => w.active !== false)
          : state.workers.filter((w) => w.id === state.printWorkerId);

      if (targets.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'hint';
        empty.textContent = 'Nessun operaio selezionato o attivo per la stampa.';
        el.printSheet.appendChild(empty);
      } else {
        targets.forEach((w, idx) => {
          const isLast = idx === targets.length - 1;
          el.printSheet.appendChild(buildSingleWorkerPrintPage(calendar, store, w, !isLast));
        });
      }
    }

    el.sendWorkerSelect.innerHTML = '';
    if (state.workers.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Nessun operaio disponibile';
      el.sendWorkerSelect.appendChild(opt);
      el.sendEmailInput.value = '';
      el.sendPhoneInput.value = '';
      el.sendMessageTextarea.value = '';
    } else {
      state.workers.forEach((w) => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = w.name;
        el.sendWorkerSelect.appendChild(opt);
      });
      if (!state.sendWorkerId || !state.workers.some((w) => w.id === state.sendWorkerId)) {
        state.sendWorkerId = state.workers[0].id;
      }
      el.sendWorkerSelect.value = state.sendWorkerId;

      const selectedWorker = state.workers.find((w) => w.id === state.sendWorkerId);
      el.sendEmailInput.value = selectedWorker.email || '';
      el.sendPhoneInput.value = selectedWorker.phone || '';

      if (!state.sendCustomMessageDirty) {
        el.sendMessageTextarea.value = Messaging.formatWorkerScheduleText({
          companyName: state.companyName,
          calendar,
          worker: selectedWorker,
          assignments: store.assignments
        });
      }
    }

    el.sendRosterStatus.innerHTML = '';
    state.workers.forEach((w) => {
      const row = document.createElement('div');
      row.className = 'send-status-row' + (w.id === state.sendWorkerId ? ' selected' : '');
      row.addEventListener('click', () => {
        state.sendWorkerId = w.id;
        state.sendCustomMessageDirty = false;
        renderAll();
      });

      const left = document.createElement('strong');
      left.textContent = w.name;

      const meta = document.createElement('div');
      meta.className = 'send-status-meta';

      const emailTag = document.createElement('span');
      emailTag.className = 'mini-tag';
      emailTag.textContent = w.email ? '✉️ Email ok' : 'No email';
      meta.appendChild(emailTag);

      const waTag = document.createElement('span');
      waTag.className = 'mini-tag';
      waTag.textContent = w.phone ? '💬 WA ok' : 'No tel';
      meta.appendChild(waTag);

      const sentInfo = store.sentLog && store.sentLog[w.id];
      if (sentInfo) {
        const sentTag = document.createElement('span');
        sentTag.className = 'mini-tag sent';
        sentTag.textContent =
          sentInfo.channel === 'whatsapp' ? '✓ Inviato WA' : '✓ Inviato Email';
        meta.appendChild(sentTag);
      }

      row.append(left, meta);
      el.sendRosterStatus.appendChild(row);
    });
  }

  function renderAll() {
    applyViewMode(state.viewMode);
    renderPeriodControls();
    renderCreateTab();
    const evaluation = getCurrentEvaluation();
    renderSidebarWorkers(evaluation.validation.stats.workers);
    renderStatusAndWarnings(evaluation);
    renderScheduleTable(evaluation);
    renderSummaryTable(evaluation);
    renderCompanyTab(evaluation);
    renderPrintAndSendTab(evaluation);
  }

  function triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Event listeners
  el.btnModeDesktop.addEventListener('click', () => {
    applyViewMode('desktop');
    saveState();
    showToast('Modalità Desktop attiva.');
  });

  el.btnModeMobile.addEventListener('click', () => {
    applyViewMode('mobile');
    saveState();
    showToast('Modalità Smartphone attiva.');
  });

  el.tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setActiveTab(btn.dataset.tab));
  });

  el.openCompanyTabBtn.addEventListener('click', () => setActiveTab('company'));
  el.openCreateTabBtn.addEventListener('click', () => setActiveTab('create'));
  el.createGoCompanyBtn.addEventListener('click', () => setActiveTab('company'));

  function changePeriod(newMonth, newYear) {
    state.month = newMonth;
    state.year = newYear;
    state.sendCustomMessageDirty = false;
    saveState();
    ensureMonthScheduleExists();
  }

  el.monthSelect.addEventListener('change', () => {
    changePeriod(Number(el.monthSelect.value), state.year);
  });

  el.yearSelect.addEventListener('change', () => {
    changePeriod(state.month, Number(el.yearSelect.value));
  });

  el.createMonthSelect.addEventListener('change', () => {
    changePeriod(Number(el.createMonthSelect.value), state.year);
  });

  el.createYearSelect.addEventListener('change', () => {
    changePeriod(state.month, Number(el.createYearSelect.value));
  });

  el.createSelectAllBtn.addEventListener('click', () => {
    state.workers.forEach((w) => {
      w.active = true;
    });
    saveState();
    renderAll();
  });

  el.createSelectNoneBtn.addEventListener('click', () => {
    state.workers.forEach((w) => {
      w.active = false;
    });
    state.highlightedWorkerId = null;
    saveState();
    renderAll();
  });

  el.createAvoidSameShiftOpt.addEventListener('change', () => {
    state.options.avoidSameShiftConsecutive = el.createAvoidSameShiftOpt.checked;
    saveState();
    renderPeriodControls();
  });

  el.createAvoidLateToEarlyOpt.addEventListener('change', () => {
    state.options.avoidLateToEarly = el.createAvoidLateToEarlyOpt.checked;
    saveState();
    renderPeriodControls();
  });

  el.createGenerateAllBtn.addEventListener('click', () => {
    if (el.createResetLocksOpt.checked) {
      getCurrentMonthStore().locks = {};
    }
    runGeneration();
    setActiveTab('schedule');
    showToast(
      `Turni di ${Scheduler.MONTH_NAMES_IT[state.month]} ${state.year} generati in automatico!`
    );
  });

  el.generateBtn.addEventListener('click', () => {
    runGeneration();
    showToast('Nuovo orario casuale generato per ' + Scheduler.MONTH_NAMES_IT[state.month] + '!');
  });

  el.addWorkerForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.workerNameInput.value.trim();
    if (!name) return;
    state.workers.push(makeWorker(name));
    el.workerNameInput.value = '';
    saveState();
    runGeneration();
  });

  el.companyNameInput.addEventListener('input', () => {
    state.companyName = el.companyNameInput.value.trim();
    state.sendCustomMessageDirty = false;
    el.sidebarCompanyLabel.textContent = state.companyName ? state.companyName : 'Lista aziendale';
    saveState();
  });

  el.companyNameInput.addEventListener('change', () => {
    state.companyName = el.companyNameInput.value.trim();
    state.sendCustomMessageDirty = false;
    saveState();
    renderAll();
  });

  el.companyAddForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.newWorkerName.value.trim();
    if (!name) return;
    const worker = makeWorker({
      name,
      role: el.newWorkerRole.value,
      email: el.newWorkerEmail.value,
      phone: el.newWorkerPhone.value,
      active: true
    });
    state.workers.push(worker);
    el.newWorkerName.value = '';
    el.newWorkerRole.value = '';
    el.newWorkerEmail.value = '';
    el.newWorkerPhone.value = '';
    saveState();
    runGeneration();
    showToast(`Aggiunto ${worker.name} alla lista azienda.`);
  });

  el.toggleBulkBtn.addEventListener('click', () => {
    el.bulkPanel.classList.toggle('hidden');
  });

  function parseBulkEntries(text) {
    return text
      .split(/\r?\n/)
      .flatMap((line) => (line.includes(';') ? [line] : line.split(',')))
      .map((s) => s.trim())
      .filter(Boolean)
      .map((entry) => {
        if (entry.includes(';')) {
          const parts = entry.split(';').map((p) => p.trim());
          return makeWorker({
            name: parts[0],
            email: parts[1] || '',
            phone: parts[2] || '',
            role: parts[3] || ''
          });
        }
        return makeWorker(entry);
      })
      .filter((w) => w.name.length > 0);
  }

  el.bulkReplaceBtn.addEventListener('click', () => {
    const list = parseBulkEntries(el.bulkTextarea.value);
    if (list.length === 0) {
      showToast('Inserisci almeno un nome.');
      return;
    }
    state.workers = list;
    getCurrentMonthStore().locks = {};
    state.highlightedWorkerId = null;
    state.sendWorkerId = null;
    el.bulkPanel.classList.add('hidden');
    runGeneration();
    showToast(`Lista azienda aggiornata con ${list.length} operai.`);
  });

  el.bulkAppendBtn.addEventListener('click', () => {
    const list = parseBulkEntries(el.bulkTextarea.value);
    if (list.length === 0) {
      showToast('Inserisci almeno un nome.');
      return;
    }
    state.workers = state.workers.concat(list);
    el.bulkPanel.classList.add('hidden');
    runGeneration();
    showToast(`Aggiunti ${list.length} operai alla lista azienda.`);
  });

  el.quickGenBtn.addEventListener('click', () => {
    const count = Math.max(1, Math.min(40, Number(el.quickCountInput.value) || 5));
    const list = [];
    for (let i = 1; i <= count; i++) {
      list.push(makeWorker({ name: `Operaio ${i}`, role: 'Operaio' }));
    }
    state.workers = list;
    getCurrentMonthStore().locks = {};
    state.highlightedWorkerId = null;
    state.sendWorkerId = null;
    runGeneration();
    showToast(`Creati ${count} operai e generato l'orario.`);
  });

  el.resetDemoBtn.addEventListener('click', () => {
    state.workers = DEFAULT_WORKERS.map(makeWorker);
    getCurrentMonthStore().locks = {};
    state.highlightedWorkerId = null;
    state.sendWorkerId = null;
    runGeneration();
    showToast('Ripristinati i 5 operai predefiniti.');
  });

  el.clearWorkersBtn.addEventListener('click', () => {
    state.workers = [];
    getCurrentMonthStore().assignments = {};
    getCurrentMonthStore().locks = {};
    state.highlightedWorkerId = null;
    state.sendWorkerId = null;
    saveState();
    renderAll();
    showToast('Lista operai svuotata.');
  });

  el.avoidSameShiftOpt.addEventListener('change', () => {
    state.options.avoidSameShiftConsecutive = el.avoidSameShiftOpt.checked;
    saveState();
    renderPeriodControls();
  });

  el.avoidLateToEarlyOpt.addEventListener('change', () => {
    state.options.avoidLateToEarly = el.avoidLateToEarlyOpt.checked;
    saveState();
    renderPeriodControls();
  });

  el.clearLocksBtn.addEventListener('click', () => {
    getCurrentMonthStore().locks = {};
    saveState();
    renderAll();
    showToast('Tutti i turni di questo mese sono stati sbloccati.');
  });

  el.clearHighlightBtn.addEventListener('click', () => {
    state.highlightedWorkerId = null;
    renderAll();
  });

  el.exportCsvBtn.addEventListener('click', () => {
    const { calendar, store } = getCurrentEvaluation();
    const csv = Exporter.buildScheduleCsv({
      calendar,
      workers: state.workers,
      assignments: store.assignments
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    triggerDownload(blob, `Orario_${calendar.monthName}_${calendar.year}.csv`);
    showToast('File CSV esportato.');
  });

  el.exportXlsxBtn.addEventListener('click', () => {
    const { calendar, validation, store } = getCurrentEvaluation();
    const bytes = Exporter.buildScheduleXlsx({
      calendar,
      workers: state.workers,
      assignments: store.assignments,
      stats: validation.stats
    });
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    triggerDownload(blob, `Orario_${calendar.monthName}_${calendar.year}.xlsx`);
    showToast('File Excel (.xlsx) esportato.');
  });

  el.importCsvInput.addEventListener('change', (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = Exporter.parseCsvTemplate(reader.result, Scheduler.MONTH_NAMES_IT);
      const msgParts = [];
      if (parsed.detectedMonth !== null) {
        state.month = parsed.detectedMonth;
        msgParts.push(`mese impostato a ${Scheduler.MONTH_NAMES_IT[state.month]}`);
      }
      if (parsed.workerNames.length > 0) {
        state.workers = parsed.workerNames.map(makeWorker);
        msgParts.push(`importati ${parsed.workerNames.length} operai`);
      }
      getCurrentMonthStore().locks = {};
      runGeneration();
      showToast(
        msgParts.length > 0
          ? 'CSV importato: ' + msgParts.join(', ') + '.'
          : 'CSV letto, nessun nome operaio trovato nelle celle.'
      );
      el.importCsvInput.value = '';
    };
    reader.readAsText(file, 'utf-8');
  });

  // Print & Send listeners
  el.printModeRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) {
        state.printMode = radio.value;
        renderPrintAndSendTab(getCurrentEvaluation());
      }
    });
  });

  el.printWorkerSelect.addEventListener('change', () => {
    state.printWorkerId = el.printWorkerSelect.value;
    renderPrintAndSendTab(getCurrentEvaluation());
  });

  el.printIncludeAllDaysOpt.addEventListener('change', () => {
    state.printIncludeAllDays = el.printIncludeAllDaysOpt.checked;
    renderPrintAndSendTab(getCurrentEvaluation());
  });

  el.executePrintBtn.addEventListener('click', () => {
    window.print();
  });

  el.sendWorkerSelect.addEventListener('change', () => {
    state.sendWorkerId = el.sendWorkerSelect.value;
    state.sendCustomMessageDirty = false;
    renderPrintAndSendTab(getCurrentEvaluation());
  });

  el.sendEmailInput.addEventListener('input', () => {
    const w = state.workers.find((x) => x.id === state.sendWorkerId);
    if (!w) return;
    w.email = el.sendEmailInput.value.trim();
    saveState();
  });

  el.sendEmailInput.addEventListener('change', () => {
    const w = state.workers.find((x) => x.id === state.sendWorkerId);
    if (!w) return;
    w.email = el.sendEmailInput.value.trim();
    saveState();
    renderAll();
  });

  el.sendPhoneInput.addEventListener('input', () => {
    const w = state.workers.find((x) => x.id === state.sendWorkerId);
    if (!w) return;
    w.phone = el.sendPhoneInput.value.trim();
    saveState();
  });

  el.sendPhoneInput.addEventListener('change', () => {
    const w = state.workers.find((x) => x.id === state.sendWorkerId);
    if (!w) return;
    w.phone = el.sendPhoneInput.value.trim();
    saveState();
    renderAll();
  });

  el.sendMessageTextarea.addEventListener('input', () => {
    state.sendCustomMessageDirty = true;
  });

  el.resetMessageBtn.addEventListener('click', () => {
    state.sendCustomMessageDirty = false;
    renderPrintAndSendTab(getCurrentEvaluation());
  });

  el.sendEmailBtn.addEventListener('click', () => {
    const w = state.workers.find((x) => x.id === state.sendWorkerId);
    if (!w) return;
    w.email = el.sendEmailInput.value.trim();
    if (!w.email) {
      showToast('Inserisci l’indirizzo email del dipendente prima di inviare.');
      el.sendEmailInput.focus();
      return;
    }
    const { calendar, store } = getCurrentEvaluation();
    const mailtoUrl = Messaging.buildMailtoUrl({
      companyName: state.companyName,
      calendar,
      worker: w,
      assignments: store.assignments,
      customBody: el.sendMessageTextarea.value
    });
    store.sentLog[w.id] = { channel: 'email', at: new Date().toISOString() };
    saveState();
    renderPrintAndSendTab(getCurrentEvaluation());
    window.location.href = mailtoUrl;
    showToast(`Apertura client email per ${w.name}...`);
  });

  el.sendWhatsAppBtn.addEventListener('click', () => {
    const w = state.workers.find((x) => x.id === state.sendWorkerId);
    if (!w) return;
    w.phone = el.sendPhoneInput.value.trim();
    const { calendar, store } = getCurrentEvaluation();
    const waUrl = Messaging.buildWhatsAppUrl({
      companyName: state.companyName,
      calendar,
      worker: w,
      assignments: store.assignments,
      customBody: el.sendMessageTextarea.value
    });
    if (!waUrl) {
      showToast('Inserisci un numero WhatsApp valido (es. +39 333 1234567).');
      el.sendPhoneInput.focus();
      return;
    }
    store.sentLog[w.id] = { channel: 'whatsapp', at: new Date().toISOString() };
    saveState();
    renderPrintAndSendTab(getCurrentEvaluation());
    window.open(waUrl, '_blank', 'noopener,noreferrer');
    showToast(`Apertura WhatsApp per ${w.name}...`);
  });

  el.copyMessageBtn.addEventListener('click', async () => {
    const text = el.sendMessageTextarea.value;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Messaggio turni copiato negli appunti!');
    } catch (_e) {
      el.sendMessageTextarea.select();
      document.execCommand('copy');
      showToast('Messaggio turni copiato!');
    }
  });

  // Boot
  const restored = loadState();
  const currentStore = getCurrentMonthStore();
  if (!restored || Object.keys(currentStore.assignments).length === 0) {
    runGeneration();
  } else {
    renderAll();
  }
})();
