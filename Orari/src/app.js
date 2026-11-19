(function () {
  'use strict';

  const Scheduler = window.OrariScheduler;
  const Exporter = window.OrariExport;
  const Messaging = window.OrariMessaging;

  const STORAGE_KEY_V4 = 'orari_turni_state_v4';
  const STORAGE_KEY_V3 = 'orari_turni_state_v3';

  const YEAR_RANGE = [2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032];
  const MAX_UNDO_STEPS = 15;

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
      avoidLateToEarly: true,
      useItalianHolidays: true
    },
    highlightedWorkerId: null,
    editingWorkerId: null,
    unavailSelectedWorkerId: null,
    printMode: 'company', // 'company' | 'worker'
    printWorkerId: 'ALL',
    printIncludeAllDays: true,
    sendWorkerId: null,
    sendCustomMessageDirty: false
  };

  const undoStack = [];

  function ensureStoreShape(store) {
    if (!store.assignments || typeof store.assignments !== 'object') store.assignments = {};
    if (!store.locks || typeof store.locks !== 'object') store.locks = {};
    if (!store.sentLog || typeof store.sentLog !== 'object') store.sentLog = {};
    if (!Array.isArray(store.excludedWorkerIds)) store.excludedWorkerIds = [];
    if (!store.unavailability || typeof store.unavailability !== 'object') store.unavailability = {};
    if (!Array.isArray(store.customHolidays)) store.customHolidays = [];
    if (!Array.isArray(store.openHolidays)) store.openHolidays = [];
    return store;
  }

  function getMonthStore(year, month) {
    const key = getMonthKey(year, month);
    if (!state.schedulesByMonth[key]) {
      state.schedulesByMonth[key] = ensureStoreShape({});
    } else {
      ensureStoreShape(state.schedulesByMonth[key]);
    }
    return state.schedulesByMonth[key];
  }

  function getCurrentMonthStore() {
    return getMonthStore(state.year, state.month);
  }

  function isWorkerActiveInMonth(worker, store) {
    if (!worker || worker.active === false) return false;
    return !(store.excludedWorkerIds || []).includes(worker.id);
  }

  function setWorkerActiveInMonth(workerId, isActive, store) {
    const set = new Set(store.excludedWorkerIds || []);
    if (isActive) {
      set.delete(workerId);
    } else {
      set.add(workerId);
    }
    store.excludedWorkerIds = Array.from(set);
  }

  function getCalendarOptionsForStore(store) {
    return {
      useItalianHolidays: state.options.useItalianHolidays !== false,
      holidays: store.customHolidays || [],
      openHolidays: store.openHolidays || []
    };
  }

  function getPreviousMonthLastDayAssignments(year, month) {
    const prevYear = month === 0 ? year - 1 : year;
    const prevMonth = month === 0 ? 11 : month - 1;
    const prevKey = getMonthKey(prevYear, prevMonth);
    const prevStore = state.schedulesByMonth[prevKey];
    if (!prevStore || !prevStore.assignments) return null;

    ensureStoreShape(prevStore);
    const prevCal = Scheduler.buildMonthCalendar(
      prevYear,
      prevMonth,
      getCalendarOptionsForStore(prevStore)
    );
    const lastDay = prevCal.days[prevCal.days.length - 1];
    if (!lastDay || lastDay.isClosed) return null;

    const out = {};
    for (const slot of lastDay.slots) {
      const wId = prevStore.assignments[`${lastDay.day}:${slot.slotKey}`];
      if (wId) out[slot.slotKey] = wId;
    }
    return Object.keys(out).length > 0 ? out : null;
  }

  function pushUndoSnapshot() {
    try {
      const snapshot = JSON.stringify({
        companyName: state.companyName,
        year: state.year,
        month: state.month,
        workers: state.workers,
        schedulesByMonth: state.schedulesByMonth,
        options: state.options
      });
      if (undoStack.length > 0 && undoStack[undoStack.length - 1] === snapshot) {
        return;
      }
      undoStack.push(snapshot);
      if (undoStack.length > MAX_UNDO_STEPS) {
        undoStack.shift();
      }
    } catch (_e) {
      // Ignore serialization issues
    }
  }

  function undoLastAction() {
    if (undoStack.length === 0) return;
    try {
      const raw = undoStack.pop();
      const parsed = JSON.parse(raw);
      state.companyName = parsed.companyName;
      state.year = parsed.year;
      state.month = parsed.month;
      state.workers = (parsed.workers || []).map(makeWorker);
      state.schedulesByMonth = parsed.schedulesByMonth || {};
      state.options = {
        avoidSameShiftConsecutive: parsed.options?.avoidSameShiftConsecutive !== false,
        avoidLateToEarly: parsed.options?.avoidLateToEarly !== false,
        useItalianHolidays: parsed.options?.useItalianHolidays !== false
      };
      state.sendCustomMessageDirty = false;
      saveState();
      renderAll();
      showToast('Ultima operazione annullata.');
    } catch (_e) {
      showToast('Impossibile annullare l’operazione.');
    }
  }

  // DOM references
  const el = {
    btnModeDesktop: document.getElementById('btnModeDesktop'),
    btnModeMobile: document.getElementById('btnModeMobile'),
    monthSelect: document.getElementById('monthSelect'),
    yearSelect: document.getElementById('yearSelect'),
    undoBtn: document.getElementById('undoBtn'),
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
    createUseItalianHolidaysOpt: document.getElementById('createUseItalianHolidaysOpt'),
    createResetLocksOpt: document.getElementById('createResetLocksOpt'),
    createSelectedCount: document.getElementById('createSelectedCount'),
    createTotalCount: document.getElementById('createTotalCount'),
    createSelectAllBtn: document.getElementById('createSelectAllBtn'),
    createSelectNoneBtn: document.getElementById('createSelectNoneBtn'),
    createWorkerCheckboxes: document.getElementById('createWorkerCheckboxes'),
    createGoCompanyBtn: document.getElementById('createGoCompanyBtn'),
    createHolidaysGrid: document.getElementById('createHolidaysGrid'),
    unavailWorkerSelect: document.getElementById('unavailWorkerSelect'),
    clearWorkerUnavailBtn: document.getElementById('clearWorkerUnavailBtn'),
    unavailDayGrid: document.getElementById('unavailDayGrid'),
    unavailSummaryList: document.getElementById('unavailSummaryList'),
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
    useItalianHolidaysOpt: document.getElementById('useItalianHolidaysOpt'),
    importCsvInput: document.getElementById('importCsvInput'),
    clearLocksBtn: document.getElementById('clearLocksBtn'),
    exportBackupBtn: document.getElementById('exportBackupBtn'),
    importBackupInput: document.getElementById('importBackupInput'),
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
    companyExportBackupBtn: document.getElementById('companyExportBackupBtn'),
    companyImportBackupInput: document.getElementById('companyImportBackupInput'),
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
    downloadIcsBtn: document.getElementById('downloadIcsBtn'),
    copyMessageBtn: document.getElementById('copyMessageBtn'),
    sendRosterStatus: document.getElementById('sendRosterStatus'),

    // Confirmation modal
    confirmModal: document.getElementById('confirmModal'),
    confirmModalTitle: document.getElementById('confirmModalTitle'),
    confirmModalBody: document.getElementById('confirmModalBody'),
    confirmCancelBtn: document.getElementById('confirmCancelBtn'),
    confirmOkBtn: document.getElementById('confirmOkBtn'),

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

  let confirmResolver = null;
  function askConfirm(title, body, okLabel = 'Conferma') {
    if (confirmResolver) {
      confirmResolver(false);
      confirmResolver = null;
    }
    el.confirmModalTitle.textContent = title;
    el.confirmModalBody.textContent = body;
    el.confirmOkBtn.textContent = okLabel;
    el.confirmModal.classList.remove('hidden');
    el.confirmCancelBtn.focus();

    return new Promise((resolve) => {
      confirmResolver = resolve;
    });
  }

  function closeConfirm(result) {
    el.confirmModal.classList.add('hidden');
    if (confirmResolver) {
      const resolve = confirmResolver;
      confirmResolver = null;
      resolve(result);
    }
  }

  el.confirmCancelBtn.addEventListener('click', () => closeConfirm(false));
  el.confirmOkBtn.addEventListener('click', () => closeConfirm(true));
  el.confirmModal.addEventListener('click', (e) => {
    if (e.target === el.confirmModal) closeConfirm(false);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !el.confirmModal.classList.contains('hidden')) {
      closeConfirm(false);
    }
  });

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
            avoidLateToEarly: parsed.options.avoidLateToEarly !== false,
            useItalianHolidays: parsed.options.useItalianHolidays !== false
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
            avoidLateToEarly: parsed.options.avoidLateToEarly !== false,
            useItalianHolidays: true
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

  function runGeneration({ recordUndo = true } = {}) {
    if (recordUndo) pushUndoSnapshot();
    const store = getCurrentMonthStore();
    const monthWorkers = state.workers.map((w) => ({
      ...w,
      active: isWorkerActiveInMonth(w, store)
    }));
    const prevDayAssignments = getPreviousMonthLastDayAssignments(state.year, state.month);

    const result = Scheduler.generateSchedule({
      year: state.year,
      month: state.month,
      workers: monthWorkers,
      locks: store.locks,
      unavailability: store.unavailability,
      prevDayAssignments,
      calendarOptions: getCalendarOptionsForStore(store),
      options: state.options
    });
    store.assignments = result.assignments;
    state.sendCustomMessageDirty = false;
    saveState();
    renderAll();
  }

  function ensureMonthScheduleExists() {
    const store = getCurrentMonthStore();
    if (
      Object.keys(store.assignments).length === 0 &&
      state.workers.some((w) => isWorkerActiveInMonth(w, store))
    ) {
      runGeneration({ recordUndo: false });
    } else {
      renderAll();
    }
  }

  function getCurrentEvaluation() {
    const store = getCurrentMonthStore();
    const calendar = Scheduler.buildMonthCalendar(
      state.year,
      state.month,
      getCalendarOptionsForStore(store)
    );
    const activeWorkers = state.workers.filter((w) => isWorkerActiveInMonth(w, store));
    const prevDayAssignments = getPreviousMonthLastDayAssignments(state.year, state.month);
    const validation = Scheduler.validateAndSummarize({
      calendar,
      workers: activeWorkers,
      assignments: store.assignments,
      unavailability: store.unavailability,
      prevDayAssignments
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
    el.useItalianHolidaysOpt.checked = state.options.useItalianHolidays !== false;
    el.createAvoidSameShiftOpt.checked = state.options.avoidSameShiftConsecutive;
    el.createAvoidLateToEarlyOpt.checked = state.options.avoidLateToEarly;
    el.createUseItalianHolidaysOpt.checked = state.options.useItalianHolidays !== false;
    el.companyTotalBadge.textContent = String(state.workers.length);
    el.sidebarCompanyLabel.textContent = state.companyName ? state.companyName : 'Lista aziendale';
    el.undoBtn.disabled = undoStack.length === 0;
  }

  function toggleHolidayForDay(dayObj, store) {
    if (dayObj.isSunday) return;
    pushUndoSnapshot();

    const italianMap = Scheduler.getItalianHolidaysForMonth(state.year, state.month);
    const isNational = state.options.useItalianHolidays !== false && italianMap.has(dayObj.day);
    const customSet = new Set(store.customHolidays || []);
    const openSet = new Set(store.openHolidays || []);

    if (dayObj.isHoliday) {
      if (isNational) openSet.add(dayObj.day);
      customSet.delete(dayObj.day);
      showToast(`${dayObj.day} ${Scheduler.MONTH_NAMES_IT[state.month]} riaperto come giorno lavorativo.`);
    } else {
      if (isNational) openSet.delete(dayObj.day);
      else customSet.add(dayObj.day);
      for (const sKey of ['mf_1', 'mf_2', 'mf_3', 'sat_1', 'sat_2']) {
        delete store.assignments[`${dayObj.day}:${sKey}`];
        delete store.locks[`${dayObj.day}:${sKey}`];
      }
      showToast(`${dayObj.day} ${Scheduler.MONTH_NAMES_IT[state.month]} segnato come Festivo/Chiuso.`);
    }

    store.customHolidays = Array.from(customSet).sort((a, b) => a - b);
    store.openHolidays = Array.from(openSet).sort((a, b) => a - b);
    state.sendCustomMessageDirty = false;
    saveState();
    renderAll();
  }

  // TAB 0: CREA TURNI
  function renderCreateTab(evaluation) {
    const { calendar: cal, store } = evaluation;
    let mfDays = 0;
    let satDays = 0;
    let sunDays = 0;
    let holidayDays = 0;
    let totalSlots = 0;
    for (const d of cal.days) {
      if (d.isSunday) sunDays++;
      else if (d.isHoliday) holidayDays++;
      else if (d.isSaturday) satDays++;
      else mfDays++;
      totalSlots += d.slots.length;
    }

    const totalHours = mfDays * 8 + satDays * 14;
    el.createCalendarInfo.innerHTML =
      `<strong>${escapeHtml(cal.monthName)} ${cal.year}</strong> (${cal.daysInMonth} giorni):<br>` +
      `• ${mfDays} giorni Lun–Ven (${mfDays * 3} turni · ${mfDays * 8}h)<br>` +
      `• ${satDays} Sabati (${satDays * 2} turni · ${satDays * 14}h)<br>` +
      `• ${sunDays} Domeniche + ${holidayDays} festività chiuse<br>` +
      `<strong>Totale da coprire: ${totalSlots} turni (${totalHours} ore)</strong>`;

    const eligibleCompanyWorkers = state.workers.filter((w) => w.active !== false);
    const activeInMonthCount = eligibleCompanyWorkers.filter((w) => isWorkerActiveInMonth(w, store)).length;
    el.createSelectedCount.textContent = String(activeInMonthCount);
    el.createTotalCount.textContent = String(eligibleCompanyWorkers.length);

    el.createWorkerCheckboxes.innerHTML = '';
    if (eligibleCompanyWorkers.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nessun operaio attivo in anagrafica. Aggiungi o attiva gli operai nella sezione "Operai".';
      el.createWorkerCheckboxes.appendChild(p);
    } else {
      eligibleCompanyWorkers.forEach((w) => {
        const checked = isWorkerActiveInMonth(w, store);
        const label = document.createElement('label');
        label.className = 'create-worker-card' + (checked ? ' checked' : '');

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = checked;
        chk.addEventListener('change', () => {
          pushUndoSnapshot();
          setWorkerActiveInMonth(w.id, chk.checked, store);
          if (!chk.checked && state.highlightedWorkerId === w.id) {
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
        sub.textContent = w.role || (checked ? 'Disponibile nel mese' : 'Escluso in questo mese');
        meta.append(strong, sub);

        label.append(chk, meta);
        el.createWorkerCheckboxes.appendChild(label);
      });
    }

    // Step 4: Holidays grid
    el.createHolidaysGrid.innerHTML = '';
    for (const dayObj of cal.days) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mini-day-btn';
      if (dayObj.isSunday) {
        btn.classList.add('is-sun');
        btn.disabled = true;
        btn.title = 'Domenica (sempre festa)';
      } else if (dayObj.isHoliday) {
        btn.classList.add('is-holiday');
        btn.title = `${dayObj.holidayName || 'Festivo'} — Clicca per riaprire`;
      } else if (dayObj.isSaturday) {
        btn.classList.add('is-sat');
        btn.title = 'Sabato lavorativo — Clicca per segnare festivo';
      } else {
        btn.title = 'Giorno lavorativo — Clicca per segnare festivo';
      }

      const num = document.createElement('span');
      num.textContent = String(dayObj.day);
      const sub = document.createElement('small');
      sub.textContent = dayObj.isHoliday ? 'Festa' : dayObj.dayNameShort;
      btn.append(num, sub);

      if (!dayObj.isSunday) {
        btn.addEventListener('click', () => toggleHolidayForDay(dayObj, store));
      }
      el.createHolidaysGrid.appendChild(btn);
    }

    // Step 5: Per-worker unavailability/leave grid
    el.unavailWorkerSelect.innerHTML = '';
    const activeWorkers = eligibleCompanyWorkers.filter((w) => isWorkerActiveInMonth(w, store));
    if (activeWorkers.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'Nessun operaio selezionato nel mese';
      el.unavailWorkerSelect.appendChild(opt);
      el.unavailDayGrid.innerHTML = '';
      el.unavailSummaryList.innerHTML = '';
      return;
    }

    if (!state.unavailSelectedWorkerId || !activeWorkers.some((w) => w.id === state.unavailSelectedWorkerId)) {
      state.unavailSelectedWorkerId = activeWorkers[0].id;
    }

    activeWorkers.forEach((w) => {
      const opt = document.createElement('option');
      opt.value = w.id;
      const cnt = (store.unavailability[w.id] || []).length;
      opt.textContent = cnt > 0 ? `${w.name} (${cnt} gg assente)` : w.name;
      el.unavailWorkerSelect.appendChild(opt);
    });
    el.unavailWorkerSelect.value = state.unavailSelectedWorkerId;

    const selectedUnavailSet = new Set(store.unavailability[state.unavailSelectedWorkerId] || []);
    el.unavailDayGrid.innerHTML = '';
    for (const dayObj of cal.days) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mini-day-btn';
      if (dayObj.isClosed) {
        btn.classList.add(dayObj.isSunday ? 'is-sun' : 'is-holiday');
        btn.disabled = true;
        btn.title = dayObj.holidayName || 'Chiuso';
      } else {
        if (dayObj.isSaturday) btn.classList.add('is-sat');
        if (selectedUnavailSet.has(dayObj.day)) btn.classList.add('is-unavail');
        btn.title = selectedUnavailSet.has(dayObj.day)
          ? 'Assente/Ferie — Clicca per rimuovere'
          : 'Disponibile — Clicca per segnare assenza/ferie';
        btn.addEventListener('click', () => {
          pushUndoSnapshot();
          const cur = new Set(store.unavailability[state.unavailSelectedWorkerId] || []);
          if (cur.has(dayObj.day)) cur.delete(dayObj.day);
          else cur.add(dayObj.day);
          if (cur.size === 0) delete store.unavailability[state.unavailSelectedWorkerId];
          else store.unavailability[state.unavailSelectedWorkerId] = Array.from(cur).sort((a, b) => a - b);
          saveState();
          renderAll();
        });
      }

      const num = document.createElement('span');
      num.textContent = String(dayObj.day);
      const sub = document.createElement('small');
      sub.textContent = selectedUnavailSet.has(dayObj.day) ? 'Ferie' : dayObj.dayNameShort;
      btn.append(num, sub);
      el.unavailDayGrid.appendChild(btn);
    }

    el.unavailSummaryList.innerHTML = '';
    for (const w of activeWorkers) {
      const daysList = store.unavailability[w.id] || [];
      if (daysList.length === 0) continue;
      const chip = document.createElement('span');
      chip.className = 'unavail-summary-chip';
      chip.textContent = `${w.name}: gg ${daysList.join(', ')}`;
      el.unavailSummaryList.appendChild(chip);
    }
  }

  function renderSidebarWorkers(evaluation) {
    const { validation, store } = evaluation;
    const statsWorkers = validation.stats.workers;
    const activeCount = state.workers.filter((w) => isWorkerActiveInMonth(w, store)).length;
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
      const activeInMonth = isWorkerActiveInMonth(worker, store);
      const item = document.createElement('div');
      item.className = 'worker-item';
      if (!activeInMonth) item.classList.add('inactive');
      if (state.highlightedWorkerId === worker.id) item.classList.add('highlighted');

      const left = document.createElement('div');
      left.className = 'worker-left';

      const chk = document.createElement('input');
      chk.type = 'checkbox';
      chk.checked = activeInMonth;
      chk.disabled = worker.active === false;
      chk.title = worker.active === false
        ? 'Disattivato in Anagrafica Azienda.'
        : chk.checked
          ? 'Partecipa ai turni di questo mese. Deseleziona per escluderlo dal mese.'
          : 'Escluso dai turni di questo mese. Seleziona per includerlo.';
      chk.addEventListener('change', () => {
        pushUndoSnapshot();
        setWorkerActiveInMonth(worker.id, chk.checked, store);
        if (!chk.checked && state.highlightedWorkerId === worker.id) {
          state.highlightedWorkerId = null;
        }
        saveState();
        renderAll();
        showToast(
          chk.checked
            ? `${worker.name} incluso in ${Scheduler.MONTH_NAMES_IT[state.month]}.`
            : `${worker.name} escluso per ${Scheduler.MONTH_NAMES_IT[state.month]}. Clicca "Genera Orario" per aggiornare.`
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
          if (nextName && nextName !== worker.name) {
            pushUndoSnapshot();
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
        pushUndoSnapshot();
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
      if (Array.isArray(monthStore.excludedWorkerIds)) {
        monthStore.excludedWorkerIds = monthStore.excludedWorkerIds.filter((id) => id !== workerId);
      }
      if (monthStore.unavailability && monthStore.unavailability[workerId]) {
        delete monthStore.unavailability[workerId];
      }
    }
    if (state.highlightedWorkerId === workerId) state.highlightedWorkerId = null;
    if (state.sendWorkerId === workerId) state.sendWorkerId = null;
    if (state.printWorkerId === workerId) state.printWorkerId = 'ALL';
    if (state.unavailSelectedWorkerId === workerId) state.unavailSelectedWorkerId = null;
    saveState();
    renderAll();
  }

  function renderStatusAndWarnings(evaluation) {
    const { activeWorkers, validation, store } = evaluation;
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

    if (!checks.noUnavailabilityConflicts) {
      pills.push({
        cls: 'err',
        text: `✕ ${checks.unavailabilityConflicts.length} turni su ferie`
      });
    }

    if (checks.lateToEarlyTransitions && checks.lateToEarlyTransitions.length > 0) {
      pills.push({
        cls: 'warn',
        text: `⚠ ${checks.lateToEarlyTransitions.length} chiusure → aperture`
      });
    }

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
      combinedWarnings.push('Servono almeno 3 operai attivi nel mese per coprire i 3 turni Lun–Ven senza doppi turni giornalieri.');
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

    const activeIds = new Set(activeWorkers.map((w) => w.id));
    const inactiveWorkerMap = new Map(
      state.workers.filter((w) => !activeIds.has(w.id)).map((w) => [w.id, w.name])
    );
    const inactiveAssignedNames = new Set();
    for (const wId of Object.values(store.assignments || {})) {
      if (inactiveWorkerMap.has(wId)) {
        inactiveAssignedNames.add(inactiveWorkerMap.get(wId));
      }
    }
    if (inactiveAssignedNames.size > 0) {
      combinedWarnings.push(
        `Dipendenti esclusi dal mese ancora presenti in tabella (${Array.from(inactiveAssignedNames).join(', ')}): clicca "Genera Orario" o sostituiscili dal menu a tendina.`
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

    const activeWorkers = state.workers.filter((w) => isWorkerActiveInMonth(w, store));
    const isUnavail = (wId) => (store.unavailability[wId] || []).includes(dayObj.day);

    const availableWorkers = activeWorkers.filter(
      (w) => (!sameDayWorkerSet.has(w.id) && !isUnavail(w.id)) || w.id === assignedId
    );
    const unavailWorkers = activeWorkers.filter(
      (w) => isUnavail(w.id) && w.id !== assignedId
    );
    const busyWorkers = activeWorkers.filter(
      (w) => sameDayWorkerSet.has(w.id) && !isUnavail(w.id) && w.id !== assignedId
    );

    if (assignedId && !activeWorkers.some((w) => w.id === assignedId)) {
      const inactiveAssigned = state.workers.find((w) => w.id === assignedId);
      if (inactiveAssigned) {
        const currentOpt = document.createElement('option');
        currentOpt.value = inactiveAssigned.id;
        currentOpt.textContent = `${inactiveAssigned.name} (escluso dal mese)`;
        select.appendChild(currentOpt);
      }
    }

    if (availableWorkers.length > 0) {
      const availGroup = document.createElement('optgroup');
      availGroup.label = 'Operai disponibili per il turno';
      availableWorkers.forEach((w) => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = isUnavail(w.id) ? `${w.name} (ferie/indisponibile!)` : w.name;
        availGroup.appendChild(opt);
      });
      select.appendChild(availGroup);
    }

    if (unavailWorkers.length > 0) {
      const unavailGroup = document.createElement('optgroup');
      unavailGroup.label = 'In ferie / non disponibili oggi';
      unavailWorkers.forEach((w) => {
        const opt = document.createElement('option');
        opt.value = w.id;
        opt.textContent = `${w.name} (ferie/assente)`;
        opt.disabled = true;
        unavailGroup.appendChild(opt);
      });
      select.appendChild(unavailGroup);
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

    if (conflictWorkerIds.has(assignedId) || (assignedId && isUnavail(assignedId))) {
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
      pushUndoSnapshot();
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
        pushUndoSnapshot();
        delete store.locks[key];
      } else if (store.assignments[key]) {
        pushUndoSnapshot();
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

    el.scheduleBody.innerHTML = '';
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
      if (dayObj.isClosed) tr.className = 'row-sun';
      else if (dayObj.isSaturday) tr.className = 'row-sat';

      const dayTd = document.createElement('td');
      const dayDiv = document.createElement('div');
      dayDiv.className = 'day-cell';
      const numSpan = document.createElement('span');
      numSpan.className = 'day-num';
      numSpan.textContent = String(dayObj.day);
      const nameSpan = document.createElement('span');
      nameSpan.textContent = dayObj.dayNameShort;
      dayDiv.append(numSpan, nameSpan);

      if (!dayObj.isSunday) {
        const holToggleBtn = document.createElement('button');
        holToggleBtn.type = 'button';
        holToggleBtn.className = 'day-holiday-toggle';
        holToggleBtn.textContent = dayObj.isHoliday ? '🔓' : '🎉';
        holToggleBtn.title = dayObj.isHoliday
          ? 'Riapri giorno come lavorativo'
          : 'Segna giorno come festivo/chiuso';
        holToggleBtn.addEventListener('click', () => toggleHolidayForDay(dayObj, store));
        dayDiv.appendChild(holToggleBtn);
      }

      dayTd.appendChild(dayDiv);
      tr.appendChild(dayTd);

      const mCard = document.createElement('div');
      mCard.className = 'mobile-day-card' + (dayObj.isClosed ? ' is-sun' : dayObj.isSaturday ? ' is-sat' : '');
      const mHeader = document.createElement('div');
      mHeader.className = 'mobile-day-header';
      mHeader.innerHTML = `<span>${escapeHtml(dayObj.dayNameFull)} ${String(dayObj.day).padStart(2, '0')} ${escapeHtml(calendar.monthName)}</span>`;

      if (dayObj.isClosed) {
        const sunTd = document.createElement('td');
        sunTd.colSpan = 3;
        sunTd.className = 'sun-holiday';
        const holidayText = dayObj.isHoliday
          ? `🎉 FESTA — ${dayObj.holidayName || 'Festivo'} (Chiuso)`
          : '🌴 FESTA — Domenica (Riposo)';
        sunTd.textContent = holidayText;

        if (dayObj.isHoliday && !dayObj.isSunday) {
          const reopenBtn = document.createElement('button');
          reopenBtn.type = 'button';
          reopenBtn.className = 'btn btn-ghost btn-xs holiday-reopen-btn';
          reopenBtn.textContent = 'Riapri giorno';
          reopenBtn.addEventListener('click', () => toggleHolidayForDay(dayObj, store));
          sunTd.appendChild(reopenBtn);
        }
        tr.appendChild(sunTd);

        const badge = document.createElement('span');
        badge.textContent = dayObj.isHoliday ? `🎉 ${dayObj.holidayName || 'Festa'}` : '🌴 FESTA';
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
          tr.appendChild(buildSlotCell(dayObj, dayObj.slots[2], sameDayWorkers, dayConflicts, store));
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
      td.textContent = 'Nessun operaio attivo nel mese.';
      tr.appendChild(td);
      el.summaryBody.appendChild(tr);

      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nessun operaio attivo nel mese.';
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
        renderPeriodControls();
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
      chk.title = 'Attivo in azienda (valido per tutti i mesi)';
      chk.addEventListener('change', () => {
        pushUndoSnapshot();
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
          pushUndoSnapshot();
          removeWorkerById(worker.id);
        });
        return [printBtn, sendBtn, delBtn];
      };

      actionsWrap.append(...makeActionBtns());
      actionsTd.appendChild(actionsWrap);
      tr.appendChild(actionsTd);
      el.companyTableBody.appendChild(tr);

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
        pushUndoSnapshot();
        worker.active = mChk.checked;
        saveState();
        renderAll();
      });
      const mTitle = document.createElement('strong');
      mTitle.textContent = 'Attivo in azienda';
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
      if (dayObj.isClosed) tr.className = 'is-sun';
      else if (dayObj.isSaturday) tr.className = 'is-sat';

      const dayLabel = `${String(dayObj.day).padStart(2, '0')} ${dayObj.dayNameShort}`;
      if (dayObj.isClosed) {
        const reason = dayObj.isHoliday
          ? `FESTA (${escapeHtml(dayObj.holidayName || 'Festivo')} — Chiuso)`
          : 'FESTA (Domenica — Riposo)';
        tr.innerHTML = `<td class="print-day-col"><strong>${dayLabel}</strong></td><td colspan="3" class="print-sun-cell">${reason}</td>`;
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
      const unavailDays = new Set(store.unavailability[worker.id] || []);
      for (const item of rowsToShow) {
        const tr = document.createElement('tr');
        if (item.isClosed) tr.className = 'is-sun';
        else if (item.slot) tr.className = 'is-working';
        else if (item.isSaturday) tr.className = 'is-sat';

        const dateLabel = `${String(item.day).padStart(2, '0')} ${calendar.monthName}`;
        let shiftHtml = unavailDays.has(item.day) ? 'Ferie / Assente' : 'Riposo';
        let hoursText = '—';
        if (item.isClosed) {
          shiftHtml = item.isHoliday
            ? `FESTA (${escapeHtml(item.holidayName || 'Festivo')})`
            : 'FESTA (Domenica)';
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
    allOpt.textContent = 'Tutti gli operai attivi nel mese (1 scheda per pagina)';
    el.printWorkerSelect.appendChild(allOpt);
    state.workers.forEach((w) => {
      const opt = document.createElement('option');
      opt.value = w.id;
      opt.textContent = isWorkerActiveInMonth(w, store) ? w.name : `${w.name} (non attivo nel mese)`;
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
          ? state.workers.filter((w) => isWorkerActiveInMonth(w, store))
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
    const evaluation = getCurrentEvaluation();

    if (state.activeTab === 'create') {
      renderCreateTab(evaluation);
    } else if (state.activeTab === 'schedule') {
      renderSidebarWorkers(evaluation);
      renderStatusAndWarnings(evaluation);
      renderScheduleTable(evaluation);
      renderSummaryTable(evaluation);
    } else if (state.activeTab === 'company') {
      renderCompanyTab(evaluation);
    } else if (state.activeTab === 'print-send') {
      renderPrintAndSendTab(evaluation);
    }
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

  function exportBackupJson() {
    const payload = {
      version: 4,
      exportedAt: new Date().toISOString(),
      companyName: state.companyName,
      year: state.year,
      month: state.month,
      workers: state.workers,
      schedulesByMonth: state.schedulesByMonth,
      options: state.options
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const dateTag = new Date().toISOString().slice(0, 10);
    triggerDownload(blob, `Backup_Orari_Turni_${dateTag}.json`);
    showToast('Backup completo (.json) esportato.');
  }

  function handleBackupImport(inputEl) {
    const file = inputEl.files && inputEl.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result || ''));
        if (!parsed || !Array.isArray(parsed.workers) || typeof parsed.schedulesByMonth !== 'object') {
          showToast('File di backup non valido.');
          inputEl.value = '';
          return;
        }
        const ok = await askConfirm(
          'Ripristina backup',
          `Vuoi sostituire i dati attuali con il backup (${parsed.workers.length} operai)? Potrai comunque annullare subito dopo con "Annulla".`,
          'Ripristina backup'
        );
        if (!ok) {
          inputEl.value = '';
          return;
        }
        pushUndoSnapshot();
        if (typeof parsed.companyName === 'string') state.companyName = parsed.companyName;
        if (typeof parsed.year === 'number') state.year = parsed.year;
        if (typeof parsed.month === 'number') state.month = parsed.month;
        state.workers = parsed.workers.map(makeWorker);
        state.schedulesByMonth = parsed.schedulesByMonth || {};
        if (parsed.options && typeof parsed.options === 'object') {
          state.options = {
            avoidSameShiftConsecutive: parsed.options.avoidSameShiftConsecutive !== false,
            avoidLateToEarly: parsed.options.avoidLateToEarly !== false,
            useItalianHolidays: parsed.options.useItalianHolidays !== false
          };
        }
        state.highlightedWorkerId = null;
        state.sendWorkerId = null;
        state.printWorkerId = 'ALL';
        state.sendCustomMessageDirty = false;
        saveState();
        renderAll();
        showToast(`Backup ripristinato con ${state.workers.length} operai.`);
      } catch (_e) {
        showToast('Errore nella lettura del file JSON.');
      } finally {
        inputEl.value = '';
      }
    };
    reader.readAsText(file, 'utf-8');
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

  el.undoBtn.addEventListener('click', undoLastAction);

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
    pushUndoSnapshot();
    const store = getCurrentMonthStore();
    store.excludedWorkerIds = [];
    saveState();
    renderAll();
  });

  el.createSelectNoneBtn.addEventListener('click', () => {
    pushUndoSnapshot();
    const store = getCurrentMonthStore();
    store.excludedWorkerIds = state.workers.map((w) => w.id);
    state.highlightedWorkerId = null;
    saveState();
    renderAll();
  });

  el.unavailWorkerSelect.addEventListener('change', () => {
    state.unavailSelectedWorkerId = el.unavailWorkerSelect.value;
    renderAll();
  });

  el.clearWorkerUnavailBtn.addEventListener('click', () => {
    const store = getCurrentMonthStore();
    if (!state.unavailSelectedWorkerId || !store.unavailability[state.unavailSelectedWorkerId]) return;
    pushUndoSnapshot();
    delete store.unavailability[state.unavailSelectedWorkerId];
    saveState();
    renderAll();
    showToast('Assenze azzerate per l’operaio selezionato.');
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

  el.createUseItalianHolidaysOpt.addEventListener('change', () => {
    pushUndoSnapshot();
    state.options.useItalianHolidays = el.createUseItalianHolidaysOpt.checked;
    saveState();
    renderAll();
  });

  el.createGenerateAllBtn.addEventListener('click', () => {
    pushUndoSnapshot();
    if (el.createResetLocksOpt.checked) {
      getCurrentMonthStore().locks = {};
    }
    runGeneration({ recordUndo: false });
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
    pushUndoSnapshot();
    state.workers.push(makeWorker(name));
    el.workerNameInput.value = '';
    saveState();
    runGeneration({ recordUndo: false });
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
    pushUndoSnapshot();
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
    runGeneration({ recordUndo: false });
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

  el.bulkReplaceBtn.addEventListener('click', async () => {
    const list = parseBulkEntries(el.bulkTextarea.value);
    if (list.length === 0) {
      showToast('Inserisci almeno un nome.');
      return;
    }
    const ok = await askConfirm(
      'Sostituisci lista azienda',
      `Vuoi sostituire l’intera lista attuale con i ${list.length} nuovi operai?`,
      'Sostituisci lista'
    );
    if (!ok) return;
    pushUndoSnapshot();
    state.workers = list;
    getCurrentMonthStore().locks = {};
    state.highlightedWorkerId = null;
    state.sendWorkerId = null;
    el.bulkPanel.classList.add('hidden');
    runGeneration({ recordUndo: false });
    showToast(`Lista azienda aggiornata con ${list.length} operai.`);
  });

  el.bulkAppendBtn.addEventListener('click', () => {
    const list = parseBulkEntries(el.bulkTextarea.value);
    if (list.length === 0) {
      showToast('Inserisci almeno un nome.');
      return;
    }
    pushUndoSnapshot();
    state.workers = state.workers.concat(list);
    el.bulkPanel.classList.add('hidden');
    runGeneration({ recordUndo: false });
    showToast(`Aggiunti ${list.length} operai alla lista azienda.`);
  });

  el.quickGenBtn.addEventListener('click', async () => {
    const count = Math.max(1, Math.min(40, Number(el.quickCountInput.value) || 5));
    const ok = await askConfirm(
      'Crea operai di test',
      `Questa azione sostituirà gli operai attuali con ${count} operai di test ("Operaio 1..${count}"). Vuoi continuare?`,
      `Crea ${count} operai`
    );
    if (!ok) return;
    pushUndoSnapshot();
    const list = [];
    for (let i = 1; i <= count; i++) {
      list.push(makeWorker({ name: `Operaio ${i}`, role: 'Operaio' }));
    }
    state.workers = list;
    getCurrentMonthStore().locks = {};
    state.highlightedWorkerId = null;
    state.sendWorkerId = null;
    runGeneration({ recordUndo: false });
    showToast(`Creati ${count} operai e generato l'orario.`);
  });

  el.resetDemoBtn.addEventListener('click', async () => {
    const ok = await askConfirm(
      'Ripristina operai predefiniti',
      'Vuoi sostituire la lista corrente con i 5 operai predefiniti?',
      'Ripristina'
    );
    if (!ok) return;
    pushUndoSnapshot();
    state.workers = DEFAULT_WORKERS.map(makeWorker);
    getCurrentMonthStore().locks = {};
    state.highlightedWorkerId = null;
    state.sendWorkerId = null;
    runGeneration({ recordUndo: false });
    showToast('Ripristinati i 5 operai predefiniti.');
  });

  el.clearWorkersBtn.addEventListener('click', async () => {
    if (state.workers.length === 0) return;
    const ok = await askConfirm(
      'Svuota lista operai',
      'Sei sicuro di voler rimuovere tutti gli operai dall’anagrafica e svuotare i turni del mese corrente?',
      'Svuota lista'
    );
    if (!ok) return;
    pushUndoSnapshot();
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

  el.useItalianHolidaysOpt.addEventListener('change', () => {
    pushUndoSnapshot();
    state.options.useItalianHolidays = el.useItalianHolidaysOpt.checked;
    saveState();
    renderAll();
  });

  el.clearLocksBtn.addEventListener('click', () => {
    pushUndoSnapshot();
    getCurrentMonthStore().locks = {};
    saveState();
    renderAll();
    showToast('Tutti i turni di questo mese sono stati sbloccati.');
  });

  el.clearHighlightBtn.addEventListener('click', () => {
    state.highlightedWorkerId = null;
    renderAll();
  });

  el.exportBackupBtn.addEventListener('click', exportBackupJson);
  el.companyExportBackupBtn.addEventListener('click', exportBackupJson);
  el.importBackupInput.addEventListener('change', () => handleBackupImport(el.importBackupInput));
  el.companyImportBackupInput.addEventListener('change', () => handleBackupImport(el.companyImportBackupInput));

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
      pushUndoSnapshot();
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
      runGeneration({ recordUndo: false });
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

  el.downloadIcsBtn.addEventListener('click', () => {
    const w = state.workers.find((x) => x.id === state.sendWorkerId);
    if (!w) return;
    const { calendar, store } = getCurrentEvaluation();
    const ics = Messaging.buildWorkerIcs({
      companyName: state.companyName,
      calendar,
      worker: w,
      assignments: store.assignments
    });
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8;' });
    const safeName = w.name.replace(/[^a-zA-Z0-9_-]+/g, '_');
    triggerDownload(blob, `Turni_${safeName}_${calendar.monthName}_${calendar.year}.ics`);
    showToast(`Calendario (.ics) scaricato per ${w.name}.`);
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
    runGeneration({ recordUndo: false });
  } else {
    renderAll();
  }
})();
