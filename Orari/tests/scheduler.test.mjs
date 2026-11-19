import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const Scheduler = require('../src/scheduler.js');
const Exporter = require('../src/xlsx.js');
const Messaging = require('../src/messaging.js');

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWorkers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `w${i + 1}`,
    name: `Operaio ${i + 1}`,
    active: true
  }));
}

test('calendar structure: Mon-Fri 3 shifts, Sat 2 shifts, Sun 0 shifts', () => {
  const cal = Scheduler.buildMonthCalendar(2026, 10); // Novembre 2026
  assert.equal(cal.monthName, 'Novembre');
  assert.equal(cal.daysInMonth, 30);

  for (const d of cal.days) {
    if (d.dow === 0) {
      assert.equal(d.isSunday, true);
      assert.equal(d.slots.length, 0);
    } else if (d.dow === 6) {
      assert.equal(d.isSaturday, true);
      assert.deepEqual(
        d.slots.map((s) => s.label),
        ['06:00 / 13:00', '13:00 / 20:00']
      );
    } else {
      assert.deepEqual(
        d.slots.map((s) => s.label),
        ['06:00 / 08:00', '14:00 / 16:00', '16:00 / 20:00']
      );
    }
  }
});

test('constraints hold across worker counts X=3..17 and multiple months', () => {
  const workerCounts = [3, 4, 5, 6, 8, 12, 15, 17];
  const months = [
    [2026, 10], // Novembre 2026 (starts on Sunday, ends on Monday)
    [2026, 9],  // Ottobre 2026
    [2026, 1]   // Febbraio 2026
  ];

  for (const [year, month] of months) {
    for (const x of workerCounts) {
      const workers = makeWorkers(x);
      const res = Scheduler.generateSchedule({
        year,
        month,
        workers,
        rng: mulberry32(1000 + x * 31 + month)
      });

      assert.equal(
        res.checks.noSameDayDoubleShift,
        true,
        `Same-day double shift found for X=${x}, ${month + 1}/${year}`
      );
      assert.equal(
        res.checks.allWorkersWeeklyMin,
        true,
        `Weekly minimum failed for X=${x}, ${month + 1}/${year}: ${JSON.stringify(res.checks.weeklyFailures)}`
      );
      assert.equal(res.checks.allSlotsFilled, true);

      // Monthly hours fairness: max - min hours should be <= 2h
      assert.ok(
        res.stats.hoursDiff <= 2,
        `Unbalanced hours for X=${x}, ${month + 1}/${year}: min=${res.stats.minHours}h, max=${res.stats.maxHours}h (diff=${res.stats.hoursDiff}h)`
      );
    }
  }
});

test('randomness & non-repetition: different seeds yield different schedules and balanced shift types', () => {
  const workers = makeWorkers(6);
  const r1 = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers,
    rng: mulberry32(1)
  });
  const r2 = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers,
    rng: mulberry32(999)
  });

  assert.notDeepEqual(r1.assignments, r2.assignments);

  // Every worker should get variety across the 3 weekday shift types (not stuck on a single shift)
  for (const st of r1.stats.workers) {
    assert.ok(st.bySlot.mf_1 >= 2, `Worker ${st.name} had too few mf_1 shifts: ${st.bySlot.mf_1}`);
    assert.ok(st.bySlot.mf_2 >= 2, `Worker ${st.name} had too few mf_2 shifts: ${st.bySlot.mf_2}`);
    assert.ok(st.bySlot.mf_3 >= 2, `Worker ${st.name} had too few mf_3 shifts: ${st.bySlot.mf_3}`);
  }
});

test('locked assignments are preserved while respecting constraints', () => {
  const workers = makeWorkers(5);
  const locks = {
    '2:mf_1': 'w3',
    '7:sat_2': 'w5'
  };
  const res = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers,
    locks,
    rng: mulberry32(42)
  });

  assert.equal(res.assignments['2:mf_1'], 'w3');
  assert.equal(res.assignments['7:sat_2'], 'w5');
  assert.equal(res.checks.noSameDayDoubleShift, true);
  assert.equal(res.checks.allWorkersWeeklyMin, true);
});

test('edge cases: X = 0, X < 3, X > 17, and inactive worker in assignments', () => {
  const empty = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers: [],
    rng: mulberry32(7)
  });
  assert.equal(empty.valid, false);
  assert.ok(empty.stats && Array.isArray(empty.stats.workers));
  assert.ok(empty.checks && empty.checks.totalSlots > 0);

  const tooFew = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers: makeWorkers(2),
    rng: mulberry32(7)
  });
  assert.equal(tooFew.valid, false);
  assert.ok(tooFew.warnings.some((w) => w.includes('almeno 3 operai')));

  const tooMany = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers: makeWorkers(19),
    rng: mulberry32(7)
  });
  assert.ok(tooMany.warnings.some((w) => w.includes('17 turni')));

  const fiveWorkers = makeWorkers(5);
  const fullRes = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers: fiveWorkers,
    rng: mulberry32(11)
  });
  assert.equal(fullRes.checks.allSlotsFilled, true);

  // Deactivate worker 1 without regenerating: filledSlots for active workers must drop
  fiveWorkers[0].active = false;
  const afterDeactivate = Scheduler.validateAndSummarize({
    calendar: fullRes.calendar,
    workers: fiveWorkers.filter((w) => w.active !== false),
    assignments: fullRes.assignments
  });
  assert.equal(afterDeactivate.checks.allSlotsFilled, false);
  assert.ok(afterDeactivate.checks.filledSlots < afterDeactivate.checks.totalSlots);
});

test('CSV export, CSV template parsing, and XLSX ZIP generation work cleanly', () => {
  const workers = makeWorkers(6);
  const res = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers,
    rng: mulberry32(123)
  });

  const csv = Exporter.buildScheduleCsv({
    calendar: res.calendar,
    workers,
    assignments: res.assignments
  });
  assert.ok(csv.includes('Novembre 2026'));
  assert.ok(csv.includes('FESTA (Domenica)'));
  assert.ok(csv.includes('06:00-13:00'));

  const parsedTemplate = Exporter.parseCsvTemplate(
    'Orario mese: ,,,Novembre\n,06:00 / 8:00,14:00 / 16:00,16:00 / 20:00\n1,,,\n',
    Scheduler.MONTH_NAMES_IT
  );
  assert.equal(parsedTemplate.detectedMonth, 10);
  assert.deepEqual(parsedTemplate.workerNames, []);

  const xlsxBytes = Exporter.buildScheduleXlsx({
    calendar: res.calendar,
    workers,
    assignments: res.assignments,
    stats: res.stats
  });

  // Verify ZIP local file header magic bytes PK\x03\x04 and End of Central Directory PK\x05\x06
  assert.ok(xlsxBytes instanceof Uint8Array);
  assert.equal(xlsxBytes[0], 0x50);
  assert.equal(xlsxBytes[1], 0x4b);
  assert.equal(xlsxBytes[2], 0x03);
  assert.equal(xlsxBytes[3], 0x04);

  const rawText = Buffer.from(xlsxBytes).toString('utf8');
  assert.ok(rawText.includes('xl/workbook.xml'));
  assert.ok(rawText.includes('xl/worksheets/sheet1.xml'));
  assert.ok(rawText.includes('xl/worksheets/sheet2.xml'));
  assert.ok(rawText.includes('Orario Turni'));
  assert.ok(rawText.includes('Riepilogo Operai'));
  assert.ok(rawText.includes('FESTA (Domenica)'));
});

test('messaging helpers: phone normalization, shift extraction, mailto and WhatsApp URLs', () => {
  assert.equal(Messaging.normalizeWhatsAppNumber('+39 333 123-4567'), '393331234567');
  assert.equal(Messaging.normalizeWhatsAppNumber('0039 3331234567'), '393331234567');
  assert.equal(Messaging.normalizeWhatsAppNumber('333 1234567'), '393331234567');
  assert.equal(Messaging.normalizeWhatsAppNumber('+41 79 123 45 67'), '41791234567');
  assert.equal(Messaging.normalizeWhatsAppNumber(''), '');

  const workers = [
    { id: 'w1', name: 'Mario Rossi', email: 'mario@azienda.it', phone: '333 1234567', active: true },
    { id: 'w2', name: 'Luca Bianchi', email: 'luca@azienda.it', phone: '334 2223344', active: true },
    { id: 'w3', name: 'Anna Verdi', email: 'anna@azienda.it', phone: '335 3334455', active: true }
  ];
  const res = Scheduler.generateSchedule({
    year: 2026,
    month: 10,
    workers,
    rng: mulberry32(55)
  });

  const summary = Messaging.extractWorkerShiftsForMonth({
    calendar: res.calendar,
    worker: workers[0],
    assignments: res.assignments
  });
  assert.equal(summary.entries.length, 30);
  assert.ok(summary.totalShifts > 0);
  assert.ok(summary.totalHours > 0);

  const text = Messaging.formatWorkerScheduleText({
    companyName: 'Officina Rossi',
    calendar: res.calendar,
    worker: workers[0],
    assignments: res.assignments
  });
  assert.ok(text.includes('Mario Rossi'));
  assert.ok(text.includes('Novembre 2026'));
  assert.ok(text.includes('Officina Rossi'));

  const mailto = Messaging.buildMailtoUrl({
    companyName: 'Officina Rossi',
    calendar: res.calendar,
    worker: workers[0],
    assignments: res.assignments
  });
  assert.ok(mailto.startsWith('mailto:mario%40azienda.it?subject='));

  const wa = Messaging.buildWhatsAppUrl({
    companyName: 'Officina Rossi',
    calendar: res.calendar,
    worker: workers[0],
    assignments: res.assignments
  });
  assert.ok(wa.startsWith('https://wa.me/393331234567?text='));
});
