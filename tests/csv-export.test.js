'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('CSV exports quote data, neutralise spreadsheet formulas, and use the requested filename', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'common.js'), 'utf8');
  let blob, anchor;
  const document = {
    addEventListener() {},
    querySelector() { return null; },
    createElement() {
      return {
        attributes: {},
        setAttribute(name, value) { this.attributes[name] = value; },
        append() {},
        click() { this.clicked = true; },
        remove() {},
      };
    },
    createTextNode(text) { return { text }; },
    body: { append(node) { anchor = node; } },
  };
  class TestBlob {
    constructor(parts, options) { this.parts = parts; this.options = options; blob = this; }
  }
  const context = {
    window: {},
    document,
    Node: class {},
    Blob: TestBlob,
    URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  };
  vm.runInNewContext(source, context);

  context.window.TT.downloadCSV('dispatch_schedule.csv', ['Train', 'Destination'], [
    ['=HYPERLINK("https://example.test")', 'North, Station'],
    ['-1+2', 'Ordinary value'],
  ]);

  assert.equal(anchor.attributes.download, 'dispatch_schedule.csv');
  assert.equal(anchor.attributes.href, 'blob:test');
  assert.equal(anchor.clicked, true);
  assert.equal(blob.options.type, 'text/csv;charset=utf-8');
  assert.equal(blob.parts[0], `Train,Destination\r\n"'=HYPERLINK(""https://example.test"")","North, Station"\r\n'-1+2,Ordinary value`);
});
