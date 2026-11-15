'use strict';
// Tablo ve veri motoru: SheetJS (XLSX/XLS/ODS/CSV/TSV) + JSON/YAML/XML.
// Tablolar JSON nesne dizisi olarak taşınır; iç içe veriler düzleştirilir.

const fs = require('fs');

const SHEETS = ['xlsx', 'xls', 'ods', 'csv', 'tsv'];
const TREES = ['json', 'yaml', 'xml'];

function XLSX() { const x = require('xlsx'); if (x.set_fs) x.set_fs(fs); return x; }

async function readTree(file, from) {
  const text = await fs.promises.readFile(file, 'utf8');
  if (from === 'json') return JSON.parse(text.replace(/^﻿/, ''));
  if (from === 'yaml') return require('js-yaml').load(text);
  if (from === 'xml') {
    const { XMLParser } = require('fast-xml-parser');
    return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: true }).parse(text);
  }
}

function writeTree(obj, to) {
  if (to === 'json') return JSON.stringify(obj, null, 2) + '\n';
  if (to === 'yaml') return require('js-yaml').dump(obj, { lineWidth: 120, noRefs: true });
  if (to === 'xml') {
    const { XMLBuilder } = require('fast-xml-parser');
    const root = obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).length === 1 ? obj : { root: Array.isArray(obj) ? { item: obj } : obj };
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '@', format: true, indentBy: '  ' }).build(root);
  }
}

/** İç içe nesneyi "a.b.c" anahtarlarıyla düzleştirir (tabloya yazmak için). */
function flatten(o, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(o || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = Array.isArray(v) ? JSON.stringify(v) : v;
  }
  return out;
}

/** Ağaçtaki ilk nesne dizisini bulur → tablo satırları. */
function rowsOf(tree) {
  if (Array.isArray(tree)) return tree.map((r) => (r && typeof r === 'object' ? flatten(r) : { value: r }));
  if (tree && typeof tree === 'object') {
    for (const v of Object.values(tree)) { const r = rowsOf(v); if (r && r.length) return r; }
    return [flatten(tree)];
  }
  return [{ value: tree }];
}

async function run({ input, output, from, to, opts }) {
  const X = XLSX();
  // Tablo → tablo / ağaç
  if (SHEETS.includes(from)) {
    const wb = X.readFile(input, { cellDates: true, codepage: 65001, FS: from === 'tsv' ? '\t' : undefined, raw: false });
    if (SHEETS.includes(to)) {
      if (to === 'csv' || to === 'tsv') {
        const ws = wb.Sheets[opts.sheet || wb.SheetNames[0]];
        const csv = X.utils.sheet_to_csv(ws, { FS: to === 'tsv' ? '\t' : (opts.delimiter || ','), blankrows: false });
        await fs.promises.writeFile(output, '﻿' + csv, 'utf8'); // BOM: Excel Türkçe karakterleri doğru açsın
      } else X.writeFile(wb, output, { bookType: to === 'xls' ? 'biff8' : to, compression: true });
      return;
    }
    const data = {};
    for (const name of wb.SheetNames) data[name] = X.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: true });
    const tree = wb.SheetNames.length === 1 ? data[wb.SheetNames[0]] : data;
    await fs.promises.writeFile(output, writeTree(to === 'xml' ? { sheets: { sheet: Object.entries(data).map(([n, rows]) => ({ '@name': n, row: rows })) } } : tree, to), 'utf8');
    return;
  }
  // Ağaç → ağaç / tablo
  const tree = await readTree(input, from);
  if (TREES.includes(to)) { await fs.promises.writeFile(output, writeTree(tree, to), 'utf8'); return; }
  const ws = X.utils.json_to_sheet(rowsOf(tree));
  if (to === 'csv' || to === 'tsv') { await fs.promises.writeFile(output, '﻿' + X.utils.sheet_to_csv(ws, { FS: to === 'tsv' ? '\t' : ',' }), 'utf8'); return; }
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, ws, 'Veri');
  X.writeFile(wb, output, { bookType: to === 'xls' ? 'biff8' : to, compression: true });
}

module.exports = [
  {
    id: 'data',
    name: 'Tablo ve veri',
    edges: [
      [SHEETS, ['xlsx', 'ods', 'csv', 'tsv', 'xls', 'json', 'yaml', 'xml'], 10],
      [TREES, ['json', 'yaml', 'xml', 'csv', 'xlsx', 'tsv', 'ods'], 10],
    ],
    run,
  },
  // Tablo → HTML (sonra Chromium ile PDF'e)
  {
    id: 'sheet-html',
    name: 'Tablo → HTML',
    edges: [[SHEETS, ['html'], 12]],
    run: async ({ input, output, from }) => {
      const X = XLSX();
      const { PRINT_CSS } = require('./document');
      const wb = X.readFile(input, { FS: from === 'tsv' ? '\t' : undefined });
      const body = wb.SheetNames.map((n) => `<h2>${n}</h2>` + X.utils.sheet_to_html(wb.Sheets[n], { header: '', footer: '' })).join('');
      await fs.promises.writeFile(output, `<!doctype html><meta charset="utf-8"><style>${PRINT_CSS} @page{size:A4 landscape} table{font-size:8.5pt}</style>${body}`, 'utf8');
    },
  },
];
module.exports.rowsOf = rowsOf;
