(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OrariMessaging = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /**
   * Normalizes a phone number into digits-only international format for wa.me links.
   * Assumes Italian +39 prefix when a 9-10 digit national mobile/landline number is entered without country code.
   */
  function normalizeWhatsAppNumber(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    const hasPlus = trimmed.startsWith('+');
    let digits = trimmed.replace(/\D/g, '');
    if (!digits) return '';

    if (digits.startsWith('00')) {
      digits = digits.slice(2);
    } else if (!hasPlus && digits.length >= 9 && digits.length <= 10 && digits.startsWith('3')) {
      digits = '39' + digits;
    }
    return digits;
  }

  /**
   * Extracts a worker's full monthly shifts and totals.
   */
  function extractWorkerShiftsForMonth({ calendar, worker, assignments }) {
    const entries = [];
    let totalShifts = 0;
    let totalHours = 0;

    for (const dayObj of calendar.days) {
      let assignedSlot = null;
      const isClosed = Boolean(dayObj.isClosed || dayObj.isSunday || dayObj.isHoliday);
      if (!isClosed) {
        for (const slot of dayObj.slots) {
          const key = `${dayObj.day}:${slot.slotKey}`;
          if (assignments[key] === worker.id) {
            assignedSlot = slot;
            totalShifts += 1;
            totalHours += slot.hours;
            break;
          }
        }
      }
      entries.push({
        day: dayObj.day,
        dayNameShort: dayObj.dayNameShort,
        dayNameFull: dayObj.dayNameFull,
        isSaturday: dayObj.isSaturday,
        isSunday: dayObj.isSunday,
        isHoliday: Boolean(dayObj.isHoliday),
        holidayName: dayObj.holidayName || null,
        isClosed,
        slot: assignedSlot
      });
    }

    return {
      entries,
      workingDays: entries.filter((e) => e.slot !== null),
      totalShifts,
      totalHours
    };
  }

  /**
   * Formats a clear Italian message containing all monthly shifts for one employee.
   */
  function formatWorkerScheduleText({ companyName, calendar, worker, assignments }) {
    const summary = extractWorkerShiftsForMonth({ calendar, worker, assignments });
    const headerCompany = companyName && companyName.trim() ? `${companyName.trim()} - ` : '';
    const lines = [];

    lines.push(`Ciao ${worker.name},`);
    lines.push(
      `ecco i tuoi turni di lavoro per ${calendar.monthName} ${calendar.year} (${headerCompany}riepilogo mensile):`
    );
    lines.push('');

    if (summary.workingDays.length === 0) {
      lines.push('Nessun turno assegnato per questo mese.');
    } else {
      for (const item of summary.workingDays) {
        const dayStr = String(item.day).padStart(2, '0');
        lines.push(`- ${item.dayNameShort} ${dayStr} ${calendar.monthName}: ${item.slot.label} (${item.slot.hours}h)`);
      }
    }

    lines.push('');
    lines.push(`Totale turni nel mese: ${summary.totalShifts} (${summary.totalHours} ore complessive).`);
    lines.push('Nota: Domenica e festività = riposo.');
    return lines.join('\n');
  }

  function buildMailtoUrl({ companyName, calendar, worker, assignments, customBody }) {
    const email = String((worker && worker.email) || '').trim();
    const prefix = companyName && companyName.trim() ? `[${companyName.trim()}] ` : '';
    const subject = `${prefix}Turni di lavoro ${calendar.monthName} ${calendar.year} - ${worker.name}`;
    const body = customBody != null
      ? customBody
      : formatWorkerScheduleText({ companyName, calendar, worker, assignments });

    return (
      'mailto:' +
      encodeURIComponent(email) +
      '?subject=' +
      encodeURIComponent(subject) +
      '&body=' +
      encodeURIComponent(body)
    );
  }

  function buildWhatsAppUrl({ companyName, calendar, worker, assignments, customBody }) {
    const phone = normalizeWhatsAppNumber(worker && worker.phone);
    if (!phone) return '';
    const body = customBody != null
      ? customBody
      : formatWorkerScheduleText({ companyName, calendar, worker, assignments });
    return `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
  }

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function icsEscape(str) {
    return String(str == null ? '' : str)
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r?\n/g, '\\n');
  }

  function parseSlotTimes(slotKey) {
    switch (slotKey) {
      case 'mf_1': return ['060000', '080000'];
      case 'mf_2': return ['140000', '160000'];
      case 'mf_3': return ['160000', '200000'];
      case 'sat_1': return ['060000', '130000'];
      case 'sat_2': return ['130000', '200000'];
      default: return ['080000', '120000'];
    }
  }

  /**
   * Generates an RFC 5545 .ics calendar file for a single employee's monthly shifts.
   */
  function buildWorkerIcs({ companyName, calendar, worker, assignments }) {
    const summary = extractWorkerShiftsForMonth({ calendar, worker, assignments });
    const now = new Date();
    const dtStamp =
      `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T` +
      `${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

    const companyLabel = companyName && companyName.trim() ? companyName.trim() : 'Azienda';
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Generatore Orario Turni//IT',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${icsEscape(`Turni ${worker.name} - ${calendar.monthName} ${calendar.year}`)}`
    ];

    const y = calendar.year;
    const m = pad2(calendar.month + 1);

    for (const item of summary.workingDays) {
      const d = pad2(item.day);
      const [startT, endT] = parseSlotTimes(item.slot.slotKey);
      const uid = `turno-${y}${m}${d}-${item.slot.slotKey}-${String(worker.id).replace(/[^a-zA-Z0-9_-]/g, '')}@orari-turni`;
      lines.push('BEGIN:VEVENT');
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${dtStamp}`);
      lines.push(`DTSTART:${y}${m}${d}T${startT}`);
      lines.push(`DTEND:${y}${m}${d}T${endT}`);
      lines.push(`SUMMARY:${icsEscape(`Turno ${item.slot.label} (${companyLabel})`)}`);
      lines.push(
        `DESCRIPTION:${icsEscape(`Operaio: ${worker.name}\\nFascia: ${item.slot.label} (${item.slot.hours}h)\\nAzienda: ${companyLabel}`)}`
      );
      lines.push('END:VEVENT');
    }

    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  return {
    normalizeWhatsAppNumber,
    extractWorkerShiftsForMonth,
    formatWorkerScheduleText,
    buildMailtoUrl,
    buildWhatsAppUrl,
    buildWorkerIcs
  };
}));
