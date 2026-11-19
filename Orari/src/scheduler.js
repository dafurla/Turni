(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OrariScheduler = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const MONTH_NAMES_IT = [
    'Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno',
    'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'
  ];

  const DAY_NAMES_SHORT_IT = ['Dom', 'Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab'];
  const DAY_NAMES_FULL_IT = [
    'Domenica', 'Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'
  ];

  const SHIFT_DEFS = {
    mf_1: { id: 'mf_1', label: '06:00 / 08:00', hours: 2, colIndex: 0 },
    mf_2: { id: 'mf_2', label: '14:00 / 16:00', hours: 2, colIndex: 1 },
    mf_3: { id: 'mf_3', label: '16:00 / 20:00', hours: 4, colIndex: 2 },
    sat_1: { id: 'sat_1', label: '06:00 / 13:00', hours: 7, colIndex: 0 },
    sat_2: { id: 'sat_2', label: '13:00 / 20:00', hours: 7, colIndex: 1 }
  };

  /**
   * Returns a shuffled copy of an array using Fisher-Yates.
   */
  function shuffle(array, rng) {
    const copy = array.slice();
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j];
      copy[j] = tmp;
    }
    return copy;
  }

  /**
   * Builds the calendar skeleton for a given year and 0-based month (0..11).
   * Groups days into Monday-Sunday weeks.
   */
  function buildMonthCalendar(year, month) {
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];
    let currentWeekIndex = 0;

    for (let dayNum = 1; dayNum <= daysInMonth; dayNum++) {
      const date = new Date(year, month, dayNum);
      const dow = date.getDay(); // 0 = Sun, 1 = Mon ... 6 = Sat

      // Start a new week on Monday (except if day 1 itself is Monday)
      if (dayNum > 1 && dow === 1) {
        currentWeekIndex++;
      }

      const isSunday = dow === 0;
      const isSaturday = dow === 6;

      let slots = [];
      if (isSaturday) {
        slots = [
          { slotKey: 'sat_1', ...SHIFT_DEFS.sat_1 },
          { slotKey: 'sat_2', ...SHIFT_DEFS.sat_2 }
        ];
      } else if (!isSunday) {
        slots = [
          { slotKey: 'mf_1', ...SHIFT_DEFS.mf_1 },
          { slotKey: 'mf_2', ...SHIFT_DEFS.mf_2 },
          { slotKey: 'mf_3', ...SHIFT_DEFS.mf_3 }
        ];
      }

      days.push({
        day: dayNum,
        dow,
        dayNameShort: DAY_NAMES_SHORT_IT[dow],
        dayNameFull: DAY_NAMES_FULL_IT[dow],
        weekIndex: currentWeekIndex,
        isSunday,
        isSaturday,
        slots
      });
    }

    // Group days into week metadata
    const weeksMap = new Map();
    for (const d of days) {
      if (!weeksMap.has(d.weekIndex)) {
        weeksMap.set(d.weekIndex, {
          weekIndex: d.weekIndex,
          days: [],
          totalSlots: 0,
          isFullWeek: false
        });
      }
      const w = weeksMap.get(d.weekIndex);
      w.days.push(d);
      w.totalSlots += d.slots.length;
    }

    const weeks = Array.from(weeksMap.values()).map((w) => {
      w.isFullWeek = w.totalSlots === 17;
      w.startDay = w.days[0].day;
      w.endDay = w.days[w.days.length - 1].day;
      return w;
    });

    return {
      year,
      month,
      monthName: MONTH_NAMES_IT[month],
      daysInMonth,
      days,
      weeks
    };
  }

  /**
   * Generates a randomized, fair, non-repetitive schedule for the given workers and month.
   *
   * @param {Object} params
   * @param {number} params.year
   * @param {number} params.month - 0-based (0=Jan, 10=Nov)
   * @param {Array<{id: string, name: string}>} params.workers - Active workers
   * @param {Object} [params.locks] - Optional locked assignments keyed by `${day}:${slotKey}` -> workerId
   * @param {Object} [params.options]
   * @param {boolean} [params.options.avoidSameShiftConsecutive=true]
   * @param {boolean} [params.options.avoidLateToEarly=true]
   * @param {function} [params.rng=Math.random]
   */
  function generateSchedule(params) {
    const {
      year,
      month,
      workers,
      locks = {},
      options = {},
      rng = Math.random
    } = params;

    const avoidSameShiftConsecutive = options.avoidSameShiftConsecutive !== false;
    const avoidLateToEarly = options.avoidLateToEarly !== false;

    const calendar = buildMonthCalendar(year, month);
    const activeWorkers = (workers || []).filter((w) => w && w.id && w.name && w.active !== false);
    const workerIds = activeWorkers.map((w) => w.id);
    const workerMap = new Map(activeWorkers.map((w) => [w.id, w]));

    const warnings = [];
    if (activeWorkers.length === 0) {
      const emptyValidation = validateAndSummarize({
        calendar,
        workers: [],
        assignments: {}
      });
      return {
        calendar,
        assignments: {},
        stats: emptyValidation.stats,
        checks: emptyValidation.checks,
        warnings: ['Aggiungi almeno 3 operai per generare i turni senza sovrapposizioni giornaliere.'],
        valid: false
      };
    }

    if (activeWorkers.length < 3) {
      warnings.push(
        `Con soli ${activeWorkers.length} operai non è possibile coprire 3 turni nello stesso giorno senza assegnare più di un turno allo stesso operaio. Aggiungi almeno 3 operai.`
      );
    }

    if (activeWorkers.length > 17) {
      warnings.push(
        `Ci sono ${activeWorkers.length} operai ma una settimana standard ha solo 17 turni: alcuni operai non potranno ricevere un turno in ogni singola settimana.`
      );
    }

    // assignments: `${day}:${slotKey}` -> workerId | null
    const assignments = {};

    // Tracking state
    const monthCount = new Map(workerIds.map((id) => [id, 0]));
    const monthHours = new Map(workerIds.map((id) => [id, 0]));
    const slotTypeCount = new Map(
      workerIds.map((id) => [
        id,
        { mf_1: 0, mf_2: 0, mf_3: 0, sat_1: 0, sat_2: 0 }
      ])
    );
    const dayAssigned = new Map(); // day -> Set(workerId)
    const workerLastDay = new Map(workerIds.map((id) => [id, -99]));
    const workerLastSlot = new Map(workerIds.map((id) => [id, null]));

    let totalMonthHours = 0;
    for (const dayObj of calendar.days) {
      for (const slot of dayObj.slots) {
        totalMonthHours += slot.hours;
      }
    }
    const targetMonthlyHours = workerIds.length > 0 ? totalMonthHours / workerIds.length : 0;

    // Pre-apply valid locks
    for (const dayObj of calendar.days) {
      const assignedToday = new Set();
      dayAssigned.set(dayObj.day, assignedToday);

      for (const slot of dayObj.slots) {
        const key = `${dayObj.day}:${slot.slotKey}`;
        const lockedId = locks[key];
        if (lockedId && workerMap.has(lockedId) && !assignedToday.has(lockedId)) {
          assignments[key] = lockedId;
          assignedToday.add(lockedId);
          monthCount.set(lockedId, monthCount.get(lockedId) + 1);
          monthHours.set(lockedId, monthHours.get(lockedId) + slot.hours);
          slotTypeCount.get(lockedId)[slot.slotKey]++;
        } else {
          assignments[key] = null;
        }
      }
    }

    // Process week by week to guarantee >= 1 shift per worker per week whenever feasible
    for (const week of calendar.weeks) {
      if (week.totalSlots === 0) continue;

      const weekCount = new Map(workerIds.map((id) => [id, 0]));
      for (const dayObj of week.days) {
        for (const slot of dayObj.slots) {
          const wId = assignments[`${dayObj.day}:${slot.slotKey}`];
          if (wId) {
            weekCount.set(wId, weekCount.get(wId) + 1);
          }
        }
      }

      // Collect unlocked slots in this week in chronological order of days,
      // with slots inside each day shuffled for randomness.
      const weekSlots = [];
      for (const dayObj of week.days) {
        const shuffledSlots = shuffle(dayObj.slots, rng);
        for (const slot of shuffledSlots) {
          const key = `${dayObj.day}:${slot.slotKey}`;
          if (!assignments[key]) {
            weekSlots.push({ dayObj, slot, key });
          }
        }
      }

      // Assign each slot by scoring eligible workers
      for (const item of weekSlots) {
        const { dayObj, slot, key } = item;
        const assignedToday = dayAssigned.get(dayObj.day);

        // Eligible workers = not already working today
        const eligible = workerIds.filter((id) => !assignedToday.has(id));
        if (eligible.length === 0) {
          assignments[key] = null;
          continue;
        }

        // Hard priority: ensure every worker gets at least 1 shift this week before
        // anyone gets a second shift in the same week
        const zeroWeekEligible = eligible.filter((id) => weekCount.get(id) === 0);
        const candidatePool = zeroWeekEligible.length > 0 ? zeroWeekEligible : eligible;

        // Score each eligible worker (lower is better)
        const scored = shuffle(candidatePool, rng).map((id) => {
          let score = 0;

          const wShifts = weekCount.get(id);
          const mShifts = monthCount.get(id);
          const mHours = monthHours.get(id);
          const sCounts = slotTypeCount.get(id);

          // 1. Strongly prioritize workers with 0 shifts in this week
          if (wShifts === 0) {
            score -= 1000000;
          } else {
            // Balance shifts within the week
            score += wShifts * 60000;
          }

          // 2. Strongly balance monthly hours (so everyone ends up within 1-2h)
          const projectedHours = mHours + slot.hours;
          const overTarget = Math.max(0, projectedHours - targetMonthlyHours);
          score += mHours * 12000 + overTarget * overTarget * 4000;

          // 3. Mildly balance shift count as secondary tie-breaker
          score += mShifts * 1200;

          // 4. Non-repetition: balance specific shift slot type (mf_1, mf_2, mf_3, sat_1, sat_2)
          score += sCounts[slot.slotKey] * 1800;

          // 4. Avoid repeating the same shift type on consecutive working days
          const prevDay = workerLastDay.get(id);
          const prevSlot = workerLastSlot.get(id);
          const dayDiff = dayObj.day - prevDay;

          if (avoidSameShiftConsecutive && prevSlot === slot.slotKey && dayDiff <= 2) {
            score += dayDiff === 1 ? 600 : 250;
          }

          // 5. Avoid late shift (16:00-20:00 or Sat 13:00-20:00) followed next day by early 06:00
          if (
            avoidLateToEarly &&
            dayDiff === 1 &&
            (prevSlot === 'mf_3' || prevSlot === 'sat_2') &&
            (slot.slotKey === 'mf_1' || slot.slotKey === 'sat_1')
          ) {
            score += 400;
          }

          // 6. Mild preference against working yesterday to spread rest days naturally
          if (dayDiff === 1) {
            score += 80;
          }

          // 7. Random tie-breaker so schedules vary randomly each generation
          score += rng() * 50;

          return { id, score };
        });

        scored.sort((a, b) => a.score - b.score);
        const chosenId = scored[0].id;

        assignments[key] = chosenId;
        assignedToday.add(chosenId);
        weekCount.set(chosenId, weekCount.get(chosenId) + 1);
        monthCount.set(chosenId, monthCount.get(chosenId) + 1);
        monthHours.set(chosenId, monthHours.get(chosenId) + slot.hours);
        slotTypeCount.get(chosenId)[slot.slotKey]++;
        workerLastDay.set(chosenId, dayObj.day);
        workerLastSlot.set(chosenId, slot.slotKey);
      }

      // Local optimization pass within the week to further reduce consecutive-same-shift
      // and slot-type imbalance without breaking daily uniqueness or weekly >= 1
      optimizeWeekSwaps(week, assignments, locks, avoidSameShiftConsecutive, avoidLateToEarly);

      // Resynchronize slotTypeCount, workerLastDay, and workerLastSlot after week swaps
      for (const id of workerIds) {
        slotTypeCount.set(id, { mf_1: 0, mf_2: 0, mf_3: 0, sat_1: 0, sat_2: 0 });
        workerLastDay.set(id, -99);
        workerLastSlot.set(id, null);
      }
      for (const d of calendar.days) {
        if (d.day > week.endDay) break;
        for (const s of d.slots) {
          const assigned = assignments[`${d.day}:${s.slotKey}`];
          if (assigned && slotTypeCount.has(assigned)) {
            slotTypeCount.get(assigned)[s.slotKey]++;
            workerLastDay.set(assigned, d.day);
            workerLastSlot.set(assigned, s.slotKey);
          }
        }
      }
    }

    // Global monthly hours equalization pass: keeps maxHours - minHours as close to 0..2h as possible
    // while preserving daily uniqueness, weekly >= 1 shift, and locks.
    if (workerIds.length >= 3) {
      balanceMonthlyHours({
        calendar,
        workerIds,
        assignments,
        locks,
        targetMonthlyHours,
        avoidSameShiftConsecutive,
        avoidLateToEarly,
        rng
      });
    }

    const validation = validateAndSummarize({
      calendar,
      workers: activeWorkers,
      assignments
    });

    return {
      calendar,
      assignments,
      stats: validation.stats,
      checks: validation.checks,
      warnings: warnings.concat(validation.warnings),
      valid: validation.valid && warnings.length === 0
    };
  }

  /**
   * Attempts pairwise swaps within the same week (between unlocked slots of the same day type)
   * when it strictly improves shift-type variety or avoids back-to-back identical shifts.
   */
  function optimizeWeekSwaps(week, assignments, locks, avoidSameShiftConsecutive, avoidLateToEarly) {
    // Collect unlocked slots in this week
    const unlocked = [];
    for (const dayObj of week.days) {
      for (const slot of dayObj.slots) {
        const key = `${dayObj.day}:${slot.slotKey}`;
        if (!locks[key] && assignments[key]) {
          unlocked.push({ dayObj, slot, key });
        }
      }
    }

    if (unlocked.length < 2) return;

    const getDayWorkers = (day) => {
      const dayObj = week.days.find((d) => d.day === day);
      const set = new Set();
      for (const s of dayObj.slots) {
        const w = assignments[`${day}:${s.slotKey}`];
        if (w) set.add(w);
      }
      return set;
    };

    const penaltyForWeek = () => {
      let penalty = 0;
      const byWorker = new Map();
      for (const dayObj of week.days) {
        for (const slot of dayObj.slots) {
          const w = assignments[`${dayObj.day}:${slot.slotKey}`];
          if (!w) continue;
          if (!byWorker.has(w)) byWorker.set(w, []);
          byWorker.get(w).push({ day: dayObj.day, slotKey: slot.slotKey });
        }
      }
      for (const entries of byWorker.values()) {
        const counts = {};
        for (let i = 0; i < entries.length; i++) {
          const cur = entries[i];
          counts[cur.slotKey] = (counts[cur.slotKey] || 0) + 1;
          if (counts[cur.slotKey] > 1) {
            penalty += (counts[cur.slotKey] - 1) * 100;
          }
          if (i > 0) {
            const prev = entries[i - 1];
            if (cur.day - prev.day === 1) {
              if (avoidSameShiftConsecutive && cur.slotKey === prev.slotKey) {
                penalty += 60;
              }
              if (
                avoidLateToEarly &&
                (prev.slotKey === 'mf_3' || prev.slotKey === 'sat_2') &&
                (cur.slotKey === 'mf_1' || cur.slotKey === 'sat_1')
              ) {
                penalty += 40;
              }
            }
          }
        }
      }
      return penalty;
    };

    let currentPenalty = penaltyForWeek();
    let improved = true;
    let passes = 0;

    while (improved && passes < 5) {
      improved = false;
      passes++;
      for (let i = 0; i < unlocked.length; i++) {
        for (let j = i + 1; j < unlocked.length; j++) {
          const a = unlocked[i];
          const b = unlocked[j];
          const wA = assignments[a.key];
          const wB = assignments[b.key];
          if (wA === wB) continue;
          if (a.slot.hours !== b.slot.hours) continue;

          // Check daily uniqueness constraint if swapping across different days
          if (a.dayObj.day !== b.dayObj.day) {
            const workersDayA = getDayWorkers(a.dayObj.day);
            const workersDayB = getDayWorkers(b.dayObj.day);
            if (workersDayA.has(wB) || workersDayB.has(wA)) continue;
          }

          // Try swap
          assignments[a.key] = wB;
          assignments[b.key] = wA;
          const nextPenalty = penaltyForWeek();
          if (nextPenalty < currentPenalty) {
            currentPenalty = nextPenalty;
            improved = true;
          } else {
            // Revert
            assignments[a.key] = wA;
            assignments[b.key] = wB;
          }
        }
      }
    }
  }

  /**
   * Global monthly hours equalization pass.
   * Performs valid transfers and swaps across the whole month so all workers finish
   * with nearly identical monthly hours (target spread <= 1-2h) while strictly
   * preserving daily uniqueness, weekly >= 1 shift (when feasible), and user locks.
   */
  function balanceMonthlyHours({ calendar, workerIds, assignments, locks, targetMonthlyHours, rng }) {
    const hoursByWorker = new Map(workerIds.map((id) => [id, 0]));
    const weekCountsByWorker = new Map(workerIds.map((id) => [id, calendar.weeks.map(() => 0)]));
    const slotCountsByWorker = new Map(
      workerIds.map((id) => [id, { mf_1: 0, mf_2: 0, mf_3: 0, sat_1: 0, sat_2: 0 }])
    );
    const dayWorkers = new Map();
    const unlockedSlots = [];

    for (const dayObj of calendar.days) {
      const set = new Set();
      dayWorkers.set(dayObj.day, set);
      for (const slot of dayObj.slots) {
        const key = `${dayObj.day}:${slot.slotKey}`;
        const wId = assignments[key];
        if (!wId) continue;
        set.add(wId);
        hoursByWorker.set(wId, (hoursByWorker.get(wId) || 0) + slot.hours);
        if (weekCountsByWorker.has(wId)) {
          weekCountsByWorker.get(wId)[dayObj.weekIndex]++;
          slotCountsByWorker.get(wId)[slot.slotKey]++;
        }
        if (!locks[key]) {
          unlockedSlots.push({
            day: dayObj.day,
            weekIndex: dayObj.weekIndex,
            slotKey: slot.slotKey,
            hours: slot.hours,
            key
          });
        }
      }
    }

    if (unlockedSlots.length === 0) return;

    const weekRequiresMinOne = calendar.weeks.map(
      (w) => w.totalSlots >= workerIds.length && w.totalSlots > 0
    );

    const computeObjective = () => {
      let minH = Infinity;
      let maxH = -Infinity;
      let sqErr = 0;
      let slotPenalty = 0;

      for (const id of workerIds) {
        const h = hoursByWorker.get(id);
        if (h < minH) minH = h;
        if (h > maxH) maxH = h;
        const diff = h - targetMonthlyHours;
        sqErr += diff * diff;

        const sc = slotCountsByWorker.get(id);
        slotPenalty +=
          sc.mf_1 * sc.mf_1 +
          sc.mf_2 * sc.mf_2 +
          sc.mf_3 * sc.mf_3 +
          sc.sat_1 * sc.sat_1 +
          sc.sat_2 * sc.sat_2;
      }

      const spread = maxH - minH;
      return {
        spread,
        score: spread * 1000000 + sqErr * 1000 + slotPenalty * 5
      };
    };

    const canLeaveWeek = (workerId, weekIndex) => {
      if (!weekRequiresMinOne[weekIndex]) return true;
      return weekCountsByWorker.get(workerId)[weekIndex] > 1;
    };

    const moveSlot = (slotEntry, fromId, toId) => {
      assignments[slotEntry.key] = toId;
      dayWorkers.get(slotEntry.day).delete(fromId);
      dayWorkers.get(slotEntry.day).add(toId);
      hoursByWorker.set(fromId, hoursByWorker.get(fromId) - slotEntry.hours);
      hoursByWorker.set(toId, hoursByWorker.get(toId) + slotEntry.hours);
      weekCountsByWorker.get(fromId)[slotEntry.weekIndex]--;
      weekCountsByWorker.get(toId)[slotEntry.weekIndex]++;
      slotCountsByWorker.get(fromId)[slotEntry.slotKey]--;
      slotCountsByWorker.get(toId)[slotEntry.slotKey]++;
    };

    const swapSlots = (a, b, wA, wB) => {
      assignments[a.key] = wB;
      assignments[b.key] = wA;
      if (a.day !== b.day) {
        dayWorkers.get(a.day).delete(wA);
        dayWorkers.get(a.day).add(wB);
        dayWorkers.get(b.day).delete(wB);
        dayWorkers.get(b.day).add(wA);
      }
      hoursByWorker.set(wA, hoursByWorker.get(wA) - a.hours + b.hours);
      hoursByWorker.set(wB, hoursByWorker.get(wB) - b.hours + a.hours);
      weekCountsByWorker.get(wA)[a.weekIndex]--;
      weekCountsByWorker.get(wA)[b.weekIndex]++;
      weekCountsByWorker.get(wB)[b.weekIndex]--;
      weekCountsByWorker.get(wB)[a.weekIndex]++;
      slotCountsByWorker.get(wA)[a.slotKey]--;
      slotCountsByWorker.get(wA)[b.slotKey]++;
      slotCountsByWorker.get(wB)[b.slotKey]--;
      slotCountsByWorker.get(wB)[a.slotKey]++;
    };

    let current = computeObjective();

    for (let pass = 0; pass < 16; pass++) {
      let improved = false;

      // 1. Try pairwise swaps (different durations or same-duration variety swaps)
      const shuffledSlots = shuffle(unlockedSlots, rng);
      for (let i = 0; i < shuffledSlots.length; i++) {
        const a = shuffledSlots[i];
        const wA = assignments[a.key];
        for (let j = i + 1; j < shuffledSlots.length; j++) {
          const b = shuffledSlots[j];
          const wB = assignments[b.key];
          if (wA === wB) continue;
          if (a.hours === b.hours && a.slotKey === b.slotKey) continue;
          if (a.hours === b.hours && current.spread > 2) continue;

          if (a.day !== b.day) {
            if (dayWorkers.get(a.day).has(wB) || dayWorkers.get(b.day).has(wA)) continue;
          }
          if (a.weekIndex !== b.weekIndex) {
            if (!canLeaveWeek(wA, a.weekIndex) || !canLeaveWeek(wB, b.weekIndex)) continue;
          }

          // Apply tentative swap
          swapSlots(a, b, wA, wB);
          const next = computeObjective();
          if (next.score < current.score - 1e-6) {
            current = next;
            improved = true;
            break; // move on from slot a since wA changed
          } else {
            // Revert
            swapSlots(a, b, wB, wA);
          }
        }
      }

      // 2. Try single-slot transfers from higher-hour worker to lower-hour worker
      if (current.spread > 1) {
        const slotsForTransfer = shuffle(unlockedSlots, rng);
        for (const s of slotsForTransfer) {
          const giver = assignments[s.key];
          if (!canLeaveWeek(giver, s.weekIndex)) continue;

          const giverHours = hoursByWorker.get(giver);
          const candidates = workerIds
            .filter((id) => id !== giver && !dayWorkers.get(s.day).has(id) && hoursByWorker.get(id) < giverHours)
            .sort((x, y) => hoursByWorker.get(x) - hoursByWorker.get(y));

          for (const receiver of candidates) {
            moveSlot(s, giver, receiver);
            const next = computeObjective();
            if (next.score < current.score - 1e-6) {
              current = next;
              improved = true;
              break;
            } else {
              moveSlot(s, receiver, giver);
            }
          }
          if (current.spread <= 1) break;
        }
      }

      if (!improved) break;
    }
  }

  /**
   * Validates constraints and builds detailed per-worker and global statistics
   * for any schedule (generated or manually edited).
   */
  function validateAndSummarize({ calendar, workers, assignments }) {
    const activeWorkers = (workers || []).filter((w) => w && w.id && w.active !== false);
    const workerStats = new Map();

    for (const w of activeWorkers) {
      workerStats.set(w.id, {
        id: w.id,
        name: w.name,
        totalShifts: 0,
        totalHours: 0,
        bySlot: { mf_1: 0, mf_2: 0, mf_3: 0, sat_1: 0, sat_2: 0 },
        byWeek: calendar.weeks.map(() => 0),
        sameDayViolations: []
      });
    }

    let totalSlots = 0;
    let filledSlots = 0;
    const sameDayConflicts = [];

    for (const dayObj of calendar.days) {
      const seenToday = new Map();
      for (const slot of dayObj.slots) {
        totalSlots++;
        const key = `${dayObj.day}:${slot.slotKey}`;
        const wId = assignments[key];
        if (!wId) continue;

        const st = workerStats.get(wId);
        if (st) {
          filledSlots++;
          st.totalShifts++;
          st.totalHours += slot.hours;
          st.bySlot[slot.slotKey]++;
          st.byWeek[dayObj.weekIndex]++;
        }

        if (seenToday.has(wId)) {
          const conflict = {
            day: dayObj.day,
            workerId: wId,
            workerName: st ? st.name : wId
          };
          sameDayConflicts.push(conflict);
          if (st) st.sameDayViolations.push(dayObj.day);
        } else {
          seenToday.set(wId, slot.slotKey);
        }
      }
    }

    // Check weekly minimum (>= 1 shift per week for each worker)
    const weeklyFailures = [];
    const partialWeekNotes = [];

    for (const week of calendar.weeks) {
      if (week.totalSlots === 0) continue; // e.g., a week with only Sunday

      if (week.totalSlots < activeWorkers.length) {
        partialWeekNotes.push(
          `Settimana ${week.weekIndex + 1} (giorni ${week.startDay}-${week.endDay}): solo ${week.totalSlots} turni disponibili per ${activeWorkers.length} operai.`
        );
        continue;
      }

      for (const st of workerStats.values()) {
        if (st.byWeek[week.weekIndex] === 0) {
          weeklyFailures.push({
            weekIndex: week.weekIndex,
            startDay: week.startDay,
            endDay: week.endDay,
            workerId: st.id,
            workerName: st.name
          });
        }
      }
    }

    const warnings = [];
    if (sameDayConflicts.length > 0) {
      warnings.push(
        `Rilevati ${sameDayConflicts.length} conflitti nello stesso giorno (un operaio ha più di un turno nello stesso giorno).`
      );
    }
    if (weeklyFailures.length > 0) {
      warnings.push(
        `${weeklyFailures.length} assegnazioni settimanali mancanti rispetto al minimo di 1 turno/settimana.`
      );
    }
    if (filledSlots < totalSlots) {
      warnings.push(
        `${totalSlots - filledSlots} turni su ${totalSlots} risultano scoperti.`
      );
    }

    const perWorkerList = Array.from(workerStats.values());
    const shiftCounts = perWorkerList.map((w) => w.totalShifts);
    const hourCounts = perWorkerList.map((w) => w.totalHours);
    const minShifts = shiftCounts.length ? Math.min(...shiftCounts) : 0;
    const maxShifts = shiftCounts.length ? Math.max(...shiftCounts) : 0;
    const minHours = hourCounts.length ? Math.min(...hourCounts) : 0;
    const maxHours = hourCounts.length ? Math.max(...hourCounts) : 0;

    return {
      valid: sameDayConflicts.length === 0 && weeklyFailures.length === 0 && filledSlots === totalSlots,
      checks: {
        noSameDayDoubleShift: sameDayConflicts.length === 0,
        sameDayConflicts,
        allWorkersWeeklyMin: weeklyFailures.length === 0,
        weeklyFailures,
        allSlotsFilled: filledSlots === totalSlots,
        totalSlots,
        filledSlots,
        partialWeekNotes
      },
      stats: {
        workers: perWorkerList,
        minShifts,
        maxShifts,
        minHours,
        maxHours,
        hoursDiff: maxHours - minHours,
        totalHours: perWorkerList.reduce((acc, w) => acc + w.totalHours, 0)
      },
      warnings
    };
  }

  return {
    MONTH_NAMES_IT,
    DAY_NAMES_SHORT_IT,
    DAY_NAMES_FULL_IT,
    SHIFT_DEFS,
    buildMonthCalendar,
    generateSchedule,
    validateAndSummarize
  };
}));
