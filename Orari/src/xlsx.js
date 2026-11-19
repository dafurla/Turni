(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.OrariExport = factory();
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function xmlEscape(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  function csvEscape(val) {
    const s = String(val == null ? '' : val);
    if (/[",;\n\r]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  /**
   * Builds CSV content compatible with the user's Excel layout.
   */
  function buildScheduleCsv({ calendar, workers, assignments }) {
    const workerMap = new Map(workers.map((w) => [w.id, w.name]));
    const lines = [];

    lines.push(['Orario mese:', '', '', `${calendar.monthName} ${calendar.year}`].map(csvEscape).join(';'));
    lines.push([
      'Giorno',
      '06:00 / 08:00 (Sab 06:00 / 13:00)',
      '14:00 / 16:00 (Sab 13:00 / 20:00)',
      '16:00 / 20:00'
    ].map(csvEscape).join(';'));

    for (const dayObj of calendar.days) {
      const label = `${dayObj.day} (${dayObj.dayNameShort})`;
      if (dayObj.isSunday || dayObj.isHoliday || dayObj.isClosed) {
        const reason = dayObj.isHoliday
          ? `FESTA (${dayObj.holidayName || 'Festivo'})`
          : 'FESTA (Domenica)';
        lines.push([label, reason, '', ''].map(csvEscape).join(';'));
      } else if (dayObj.isSaturday) {
        const w1 = workerMap.get(assignments[`${dayObj.day}:sat_1`]) || '';
        const w2 = workerMap.get(assignments[`${dayObj.day}:sat_2`]) || '';
        lines.push([
          label,
          w1 ? `${w1} [06:00-13:00]` : '',
          w2 ? `${w2} [13:00-20:00]` : '',
          '—'
        ].map(csvEscape).join(';'));
      } else {
        const w1 = workerMap.get(assignments[`${dayObj.day}:mf_1`]) || '';
        const w2 = workerMap.get(assignments[`${dayObj.day}:mf_2`]) || '';
        const w3 = workerMap.get(assignments[`${dayObj.day}:mf_3`]) || '';
        lines.push([label, w1, w2, w3].map(csvEscape).join(';'));
      }
    }

    // UTF-8 BOM so Excel opens Italian accents cleanly
    return '\uFEFF' + lines.join('\r\n');
  }

  /**
   * Parses a CSV template (like the user's "Orario mese: ,,,Novembre") to extract
   * detected month index (0..11) and any worker names already present in cells.
   */
  function parseCsvTemplate(text, monthNamesIt) {
    const clean = String(text || '').replace(/^\uFEFF/, '');
    const lines = clean.split(/\r?\n/).filter((l) => l.trim().length > 0);
    let detectedMonth = null;
    const foundNames = new Set();

    const splitLine = (line) => {
      const sep = line.includes(';') ? ';' : ',';
      const out = [];
      let cur = '';
      let inQuotes = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (inQuotes && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = !inQuotes;
          }
        } else if (ch === sep && !inQuotes) {
          out.push(cur.trim());
          cur = '';
        } else {
          cur += ch;
        }
      }
      out.push(cur.trim());
      return out;
    };

    const ignoredTokens = new Set(['festa', 'festa (domenica)', 'domenica', 'riposo', '—', '-']);

    for (let r = 0; r < lines.length; r++) {
      const cols = splitLine(lines[r]);
      if (r === 0) {
        for (const c of cols) {
          const lower = c.toLowerCase();
          const idx = monthNamesIt.findIndex((m) => lower.includes(m.toLowerCase()));
          if (idx !== -1) {
            detectedMonth = idx;
          }
        }
        continue;
      }
      if (r === 1) continue; // shift header row

      for (let c = 1; c < cols.length; c++) {
        const raw = cols[c].replace(/\s*\[[^\]]+\]\s*$/, '').trim();
        if (!raw) continue;
        if (ignoredTokens.has(raw.toLowerCase())) continue;
        if (/^\d+$/.test(raw)) continue;
        foundNames.add(raw);
      }
    }

    return {
      detectedMonth,
      workerNames: Array.from(foundNames)
    };
  }

  // --- Minimal Pure-JS ZIP (STORE) + CRC32 for valid .xlsx generation ---

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function encodeUtf8(str) {
    if (typeof TextEncoder !== 'undefined') {
      return new TextEncoder().encode(str);
    }
    return Uint8Array.from(Buffer.from(str, 'utf8'));
  }

  function createZipUint8Array(entries) {
    const fileParts = [];
    const centralParts = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = encodeUtf8(entry.name);
      const dataBytes = typeof entry.content === 'string' ? encodeUtf8(entry.content) : entry.content;
      const crc = crc32(dataBytes);
      const size = dataBytes.length;

      // Local file header (30 bytes + name)
      const localHeader = new ArrayBuffer(30 + nameBytes.length);
      const lv = new DataView(localHeader);
      lv.setUint32(0, 0x04034b50, true); // signature
      lv.setUint16(4, 20, true); // version needed
      lv.setUint16(6, 0x0800, true); // UTF-8 flag
      lv.setUint16(8, 0, true); // compression 0 (STORE)
      lv.setUint16(10, 0, true); // mod time
      lv.setUint16(12, 0x5421, true); // mod date
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true); // extra len
      new Uint8Array(localHeader, 30).set(nameBytes);

      const localBytes = new Uint8Array(localHeader);
      fileParts.push(localBytes, dataBytes);

      // Central directory header (46 bytes + name)
      const centralHeader = new ArrayBuffer(46 + nameBytes.length);
      const cv = new DataView(centralHeader);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x5421, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      new Uint8Array(centralHeader, 46).set(nameBytes);

      centralParts.push(new Uint8Array(centralHeader));
      offset += localBytes.length + dataBytes.length;
    }

    let centralSize = 0;
    for (const part of centralParts) centralSize += part.length;

    const eocd = new ArrayBuffer(22);
    const ev = new DataView(eocd);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    const totalLen = offset + centralSize + 22;
    const out = new Uint8Array(totalLen);
    let pos = 0;
    for (const p of fileParts) {
      out.set(p, pos);
      pos += p.length;
    }
    for (const p of centralParts) {
      out.set(p, pos);
      pos += p.length;
    }
    out.set(new Uint8Array(eocd), pos);
    return out;
  }

  function colLetter(indexZeroBased) {
    let n = indexZeroBased + 1;
    let s = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      s = String.fromCharCode(65 + rem) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function buildWorksheetXml(rows, colWidths) {
    const colsXml = colWidths
      .map((w, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${w}" customWidth="1"/>`)
      .join('');

    const rowsXml = rows
      .map((row, rIdx) => {
        const rNum = rIdx + 1;
        const cellsXml = row.cells
          .map((cell, cIdx) => {
            const ref = `${colLetter(cIdx)}${rNum}`;
            const styleAttr = cell.style != null ? ` s="${cell.style}"` : '';
            if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
              return `<c r="${ref}"${styleAttr}><v>${cell.value}</v></c>`;
            }
            const text = cell.value == null ? '' : String(cell.value);
            return `<c r="${ref}" t="inlineStr"${styleAttr}><is><t>${xmlEscape(text)}</t></is></c>`;
          })
          .join('');
        const ht = row.height ? ` ht="${row.height}" customHeight="1"` : '';
        return `<row r="${rNum}"${ht}>${cellsXml}</row>`;
      })
      .join('');

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<cols>${colsXml}</cols>` +
      `<sheetData>${rowsXml}</sheetData>` +
      `</worksheet>`;
  }

  /**
   * Builds a valid .xlsx workbook Uint8Array with 2 sheets:
   *  1) Orario Turni
   *  2) Riepilogo Operai
   */
  function buildScheduleXlsx({ calendar, workers, assignments, stats }) {
    const workerMap = new Map(workers.map((w) => [w.id, w.name]));

    // Style indices in styles.xml:
    // 0: default
    // 1: title bold
    // 2: table header (blue fill, white bold)
    // 3: normal bordered cell
    // 4: saturday bordered cell (amber tint)
    // 5: sunday holiday cell (rose/red tint, bold)
    // 6: day column bold bordered
    const sheet1Rows = [];
    sheet1Rows.push({
      height: 24,
      cells: [
        { value: 'Orario mese:', style: 1 },
        { value: '', style: 1 },
        { value: '', style: 1 },
        { value: `${calendar.monthName} ${calendar.year}`, style: 1 }
      ]
    });
    sheet1Rows.push({
      height: 24,
      cells: [
        { value: 'Giorno', style: 2 },
        { value: '06:00 / 08:00 (Sab 06:00 / 13:00)', style: 2 },
        { value: '14:00 / 16:00 (Sab 13:00 / 20:00)', style: 2 },
        { value: '16:00 / 20:00', style: 2 }
      ]
    });

    for (const dayObj of calendar.days) {
      const label = `${dayObj.day} (${dayObj.dayNameShort})`;
      if (dayObj.isSunday || dayObj.isHoliday || dayObj.isClosed) {
        const reason = dayObj.isHoliday
          ? `FESTA (${dayObj.holidayName || 'Festivo'})`
          : 'FESTA (Domenica)';
        sheet1Rows.push({
          height: 20,
          cells: [
            { value: label, style: 5 },
            { value: reason, style: 5 },
            { value: 'Riposo', style: 5 },
            { value: 'Riposo', style: 5 }
          ]
        });
      } else if (dayObj.isSaturday) {
        const w1 = workerMap.get(assignments[`${dayObj.day}:sat_1`]) || '';
        const w2 = workerMap.get(assignments[`${dayObj.day}:sat_2`]) || '';
        sheet1Rows.push({
          height: 20,
          cells: [
            { value: label, style: 4 },
            { value: w1 ? `${w1} (06:00-13:00)` : '', style: 4 },
            { value: w2 ? `${w2} (13:00-20:00)` : '', style: 4 },
            { value: '— (2 turni)', style: 4 }
          ]
        });
      } else {
        const w1 = workerMap.get(assignments[`${dayObj.day}:mf_1`]) || '';
        const w2 = workerMap.get(assignments[`${dayObj.day}:mf_2`]) || '';
        const w3 = workerMap.get(assignments[`${dayObj.day}:mf_3`]) || '';
        sheet1Rows.push({
          height: 20,
          cells: [
            { value: label, style: 6 },
            { value: w1, style: 3 },
            { value: w2, style: 3 },
            { value: w3, style: 3 }
          ]
        });
      }
    }

    // Sheet 2: Riepilogo Operai
    const sheet2Rows = [];
    sheet2Rows.push({
      height: 24,
      cells: [
        { value: `Riepilogo ${calendar.monthName} ${calendar.year}`, style: 1 }
      ]
    });
    sheet2Rows.push({
      height: 24,
      cells: [
        { value: 'Operaio', style: 2 },
        { value: 'Turni Totali', style: 2 },
        { value: 'Ore Totali', style: 2 },
        { value: '06:00-08:00', style: 2 },
        { value: '14:00-16:00', style: 2 },
        { value: '16:00-20:00', style: 2 },
        { value: 'Sab 06:00-13:00', style: 2 },
        { value: 'Sab 13:00-20:00', style: 2 }
      ]
    });

    const summaryWorkers = (stats && stats.workers) ? stats.workers : [];
    for (const st of summaryWorkers) {
      sheet2Rows.push({
        height: 20,
        cells: [
          { value: st.name, style: 6 },
          { value: st.totalShifts, style: 3 },
          { value: st.totalHours, style: 3 },
          { value: st.bySlot.mf_1, style: 3 },
          { value: st.bySlot.mf_2, style: 3 },
          { value: st.bySlot.mf_3, style: 3 },
          { value: st.bySlot.sat_1, style: 3 },
          { value: st.bySlot.sat_2, style: 3 }
        ]
      });
    }

    const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
      `<fonts count="4">` +
        `<font><sz val="11"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="12"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="11"/><color rgb="FF991B1B"/><name val="Calibri"/></font>` +
      `</fonts>` +
      `<fills count="5">` +
        `<fill><patternFill patternType="none"/></fill>` +
        `<fill><patternFill patternType="gray125"/></fill>` +
        `<fill><patternFill patternType="solid"><fgColor rgb="FF1E3A8A"/></patternFill></fill>` +
        `<fill><patternFill patternType="solid"><fgColor rgb="FFFEF3C7"/></patternFill></fill>` +
        `<fill><patternFill patternType="solid"><fgColor rgb="FFFEE2E2"/></patternFill></fill>` +
      `</fills>` +
      `<borders count="2">` +
        `<border><left/><right/><top/><bottom/><diagonal/></border>` +
        `<border>` +
          `<left style="thin"><color rgb="FFD1D5DB"/></left>` +
          `<right style="thin"><color rgb="FFD1D5DB"/></right>` +
          `<top style="thin"><color rgb="FFD1D5DB"/></top>` +
          `<bottom style="thin"><color rgb="FFD1D5DB"/></bottom>` +
          `<diagonal/>` +
        `</border>` +
      `</borders>` +
      `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
      `<cellXfs count="7">` +
        `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>` +
        `<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
        `<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
        `<xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
        `<xf numFmtId="0" fontId="3" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>` +
      `</cellXfs>` +
      `</styleSheet>`;

    const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
      `<Default Extension="xml" ContentType="application/xml"/>` +
      `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>` +
      `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
      `</Types>`;

    const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>` +
      `</Relationships>`;

    const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
      `<sheets>` +
      `<sheet name="Orario Turni" sheetId="1" r:id="rId1"/>` +
      `<sheet name="Riepilogo Operai" sheetId="2" r:id="rId2"/>` +
      `</sheets>` +
      `</workbook>`;

    const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>` +
      `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
      `</Relationships>`;

    const sheet1Xml = buildWorksheetXml(sheet1Rows, [14, 34, 34, 24]);
    const sheet2Xml = buildWorksheetXml(sheet2Rows, [24, 14, 14, 14, 14, 14, 16, 16]);

    return createZipUint8Array([
      { name: '[Content_Types].xml', content: contentTypesXml },
      { name: '_rels/.rels', content: relsXml },
      { name: 'xl/workbook.xml', content: workbookXml },
      { name: 'xl/_rels/workbook.xml.rels', content: workbookRelsXml },
      { name: 'xl/styles.xml', content: stylesXml },
      { name: 'xl/worksheets/sheet1.xml', content: sheet1Xml },
      { name: 'xl/worksheets/sheet2.xml', content: sheet2Xml }
    ]);
  }

  return {
    buildScheduleCsv,
    buildScheduleXlsx,
    parseCsvTemplate
  };
}));
