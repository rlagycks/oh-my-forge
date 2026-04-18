'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const auditScript = path.join(repoRoot, 'scripts', 'ci', 'audit-source-docs.js');

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS ${name}`);
    return true;
  } catch (err) {
    console.error(`  FAIL ${name}: ${err.message}`);
    return false;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
}

function writeFile(filePath, content = '# Doc\n') {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}

function withRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'source-docs-audit-'));
  try {
    return fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

let passed = 0;
let failed = 0;

console.log('\naudit-source-docs.test.js');

if (test('auditSourceDocs reports source-like docs missing from ontology sourceDocs', () => {
  withRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'docs', 'product', 'payments.prd.md'));
    writeFile(path.join(tempRoot, 'docs', 'api', 'payments.api.md'));
    writeFile(path.join(tempRoot, 'docs', 'notes', 'random.md'));
    writeJson(path.join(tempRoot, '.claude', 'ontology', 'index.json'), {
      domain_payments: {
        summary: 'payments',
        files: ['src/payments/'],
        sourceDocs: {
          prd: ['docs/product/payments.prd.md'],
        },
      },
    });

    const { auditSourceDocs } = require(auditScript);
    const report = auditSourceDocs({ repoRoot: tempRoot });

    assert.deepStrictEqual(report.candidates, [
      'docs/api/payments.api.md',
      'docs/product/payments.prd.md',
    ]);
    assert.deepStrictEqual(report.missing, ['docs/api/payments.api.md']);
  });
})) passed++; else failed++;

if (test('auditSourceDocs treats detail sourceDocs as covered', () => {
  withRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'docs', 'api', 'payments.api.md'));
    writeJson(path.join(tempRoot, '.claude', 'ontology', 'index.json'), {
      domain_payments: {
        summary: 'payments',
        files: ['src/payments/'],
        detail: '.claude/ontology/domain_payments.json',
      },
    });
    writeJson(path.join(tempRoot, '.claude', 'ontology', 'domain_payments.json'), {
      domain: 'domain_payments',
      sourceDocs: {
        apiSpec: ['docs/api/payments.api.md'],
      },
    });

    const { auditSourceDocs } = require(auditScript);
    const report = auditSourceDocs({ repoRoot: tempRoot });

    assert.deepStrictEqual(report.missing, []);
  });
})) passed++; else failed++;

if (test('CLI --strict exits non-zero when source docs are unlinked', () => {
  withRepo(tempRoot => {
    writeFile(path.join(tempRoot, 'docs', 'product', 'checkout.prd.md'));
    writeJson(path.join(tempRoot, '.claude', 'ontology', 'index.json'), {});

    const result = spawnSync(process.execPath, [auditScript, '--repo-root', tempRoot, '--strict'], {
      encoding: 'utf8',
    });

    assert.notStrictEqual(result.status, 0, result.stdout);
    assert.ok(result.stdout.includes('docs/product/checkout.prd.md'), result.stdout);
  });
})) passed++; else failed++;

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
