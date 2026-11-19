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
      if (!dayObj.isSunday) {
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
    lines.push('Nota: Domenica festa (riposo).');
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

  return {
    normalizeWhatsAppNumber,
    extractWorkerShiftsForMonth,
    formatWorkerScheduleText,
    buildMailtoUrl,
    buildWhatsAppUrl
  };
}));
