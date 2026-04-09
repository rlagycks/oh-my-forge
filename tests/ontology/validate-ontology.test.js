'use strict';
/**
 * Validate .claude/ontology/index.json structure.
 *
 * Run with: node tests/ontology/validate-ontology.test.js
 *
 * Checks:
 * - Every domain has required fields (files, spec, owner, constraints)
 * - spec file exists on disk
 * - dependsOn references exist in the index
 * - No circular dependsOn
 * - riskLevel is a known value when present
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const indexPath = path.join(repoRoot, '.claude', 'ontology', 'index.json');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
    return true;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    return false;
  }
}

let passed = 0;
let failed = 0;

function run(name, fn) {
  if (test(name, fn)) passed++; else failed++;
}

console.log('\n=== Validating .claude/ontology/index.json ===\n');

// Load index
let index;
run('index.json is valid JSON', () => {
  const raw = fs.readFileSync(indexPath, 'utf8');
  index = JSON.parse(raw);
});

if (!index) {
  console.log('\nCannot continue — index.json failed to parse.');
  process.exit(1);
}

const domains = Object.entries(index).filter(([k]) => !k.startsWith('$'));
const domainKeys = new Set(domains.map(([k]) => k));

const VALID_RISK_LEVELS = new Set(['high', 'medium', 'low']);

for (const [key, entry] of domains) {
  run(`${key}: has files array`, () => {
    assert.ok(Array.isArray(entry.files) && entry.files.length > 0,
      `files must be a non-empty array`);
  });

  run(`${key}: has spec field`, () => {
    assert.ok(typeof entry.spec === 'string' && entry.spec.length > 0,
      `spec must be a non-empty string`);
  });

  run(`${key}: spec file exists`, () => {
    const specPath = path.join(repoRoot, entry.spec);
    assert.ok(fs.existsSync(specPath), `spec file not found: ${entry.spec}`);
  });

  run(`${key}: has owner field`, () => {
    assert.ok(typeof entry.owner === 'string' && entry.owner.length > 0,
      `owner must be a non-empty string`);
  });

  run(`${key}: has constraints array`, () => {
    assert.ok(Array.isArray(entry.constraints) && entry.constraints.length > 0,
      `constraints must be a non-empty array`);
  });

  if (entry.dependsOn) {
    run(`${key}: dependsOn references exist`, () => {
      assert.ok(Array.isArray(entry.dependsOn), `dependsOn must be an array`);
      for (const dep of entry.dependsOn) {
        assert.ok(domainKeys.has(dep), `dependsOn references unknown domain: ${dep}`);
        assert.ok(dep !== key, `domain cannot depend on itself`);
      }
    });
  }

  if (entry.riskLevel !== undefined) {
    run(`${key}: riskLevel is valid`, () => {
      assert.ok(VALID_RISK_LEVELS.has(entry.riskLevel),
        `riskLevel must be one of: ${[...VALID_RISK_LEVELS].join(', ')}`);
    });
  }
}

// No circular dependsOn (DFS)
run('no circular dependsOn', () => {
  function hasCycle(key, visited, stack) {
    visited.add(key);
    stack.add(key);
    const entry = index[key];
    for (const dep of (entry?.dependsOn || [])) {
      if (!visited.has(dep)) {
        if (hasCycle(dep, visited, stack)) return dep;
      } else if (stack.has(dep)) {
        return dep;
      }
    }
    stack.delete(key);
    return null;
  }
  const visited = new Set();
  for (const [key] of domains) {
    if (!visited.has(key)) {
      const cycle = hasCycle(key, visited, new Set());
      assert.ok(!cycle, `circular dependency detected involving: ${cycle}`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
