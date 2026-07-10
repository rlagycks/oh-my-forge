'use strict';

/**
 * Ontology Blast Radius — dependsOn auto-inference.
 *
 * Given the parsed index.json object, infers likely `dependsOn` relationships
 * between domains by two passes:
 *
 *  Pass 1 — Path overlap:
 *    If any path in domain_A.files[] is a path-prefix of (or equal to) a path
 *    in domain_B.files[], domain_B likely depends on domain_A.
 *    e.g. "scripts/lib/state-store/" appears in both domain_state_store and
 *    domain_session — so domain_session → domain_state_store.
 *
 *  Pass 2 — require() scanning:
 *    Reads each file listed in domain_X.files[] (that actually exists and is .js).
 *    Greps for require('...') / require("...") calls.
 *    Resolves the required path relative to the file location and checks whether
 *    it falls inside the files[] of another domain.
 *
 * Returns an object:
 *   {
 *     domain_session: ['domain_state_store'],
 *     domain_hooks:   ['domain_common'],
 *     ...
 *   }
 *
 * Only returns entries where at least one new dependency was found that is not
 * already present in the existing dependsOn array.
 *
 * Pure analysis — never writes to index.json. Callers decide whether to apply.
 *
 * Usage:
 *   const { inferDependsOn } = require('./ontology-blast-radius');
 *   const suggestions = inferDependsOn(projectRoot, indexJson);
 *
 * ---
 *
 * traverseDependsOn() — the OTHER kind of traversal in this file.
 *
 * inferDependsOn() (above) *discovers new* dependsOn edges from path-overlap
 * and require() heuristics, for ontology-sync to propose additions to
 * index.json. traverseDependsOn() does the opposite: it walks edges that are
 * *already recorded* in a domain graph (index.json's flat form, or the merged
 * domainMap produced by ontology-routing's loadOntologyMaps) — no file I/O,
 * no inference, just graph traversal.
 *
 * Direction matters and the two directions mean different things:
 *   - 'forward' (default): follow each domain's own dependsOn array — "what
 *     does this domain rely on". This is the direction
 *     scripts/hooks/domain-context-inject.js uses at depth 1 to surface a
 *     touched domain's upstream constraints (the domains it depends on).
 *   - 'reverse': follow edges backwards — "which domains declare a dependsOn
 *     on this one". This is the classic blast-radius / impact-analysis
 *     direction (what else might break if this domain changes). Exposed for
 *     future callers; no hook wires it up yet.
 *
 * domain-context-inject.js previously implemented its own one-hop forward
 * walk inline (`packet.dependsOn.filter(...)`). It has been refactored to
 * call traverseDependsOn(domainKey, domainMap, { depth: 1, direction:
 * 'forward' }) instead, so there is a single traversal implementation for
 * both this hook and any future blast-radius consumer.
 *
 * Usage:
 *   const { traverseDependsOn } = require('./ontology-blast-radius');
 *   const upstream = traverseDependsOn('domain_foo', domainMap, { depth: 1 });
 */

const fs = require('fs');
const path = require('path');

// Match:  require('./foo')  require('../lib/bar')  require("baz")
// Captures the module specifier (group 1).
const REQUIRE_RE = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

/**
 * Normalise a file[] path entry into an absolute path.
 * Entries may be files or directories (trailing slash or plain).
 * @param {string} projectRoot
 * @param {string} entry
 * @returns {string}
 */
function toAbs(projectRoot, entry) {
  return path.resolve(projectRoot, entry);
}

/**
 * Collect all actual JS file paths reachable from a files[] entry.
 * Directories are walked (non-recursively) for .js files.
 * Non-existent paths are silently skipped.
 * @param {string} projectRoot
 * @param {string[]} filesArr
 * @returns {string[]}  Absolute .js paths
 */
function collectJsFiles(projectRoot, filesArr) {
  const result = [];
  for (const entry of filesArr) {
    const abs = toAbs(projectRoot, entry);
    try {
      const stat = fs.statSync(abs);
      if (stat.isDirectory()) {
        for (const child of fs.readdirSync(abs)) {
          if (child.endsWith('.js')) {
            result.push(path.join(abs, child));
          }
        }
      } else if (abs.endsWith('.js')) {
        result.push(abs);
      }
    } catch {
      // file doesn't exist — skip
    }
  }
  return result;
}

/**
 * Build a map from absolute file/dir path → domain key.
 * Used for Pass 1 (path overlap) and Pass 2 (require resolution).
 * @param {string} projectRoot
 * @param {object} indexJson  Parsed index.json (without $schema key).
 * @returns {Map<string, string>}  absPath → domainKey
 */
function buildPathMap(projectRoot, indexJson) {
  const map = new Map();
  for (const [domain, entry] of Object.entries(indexJson)) {
    if (domain === '$schema' || !Array.isArray(entry.files)) continue;
    for (const f of entry.files) {
      map.set(toAbs(projectRoot, f), domain);
    }
  }
  return map;
}

/**
 * Pass 1: path-prefix overlap.
 * @param {string} projectRoot
 * @param {object} indexJson
 * @returns {Map<string, Set<string>>}  domainKey → Set<dependsOnDomainKey>
 */
function passPathOverlap(projectRoot, indexJson) {
  const result = new Map();
  const domains = Object.entries(indexJson).filter(([k]) => k !== '$schema');

  for (const [domainA, entryA] of domains) {
    if (!Array.isArray(entryA.files)) continue;
    const absPathsA = entryA.files.map(f => toAbs(projectRoot, f));

    for (const [domainB, entryB] of domains) {
      if (domainA === domainB) continue;
      if (!Array.isArray(entryB.files)) continue;

      for (const absA of absPathsA) {
        for (const fB of entryB.files) {
          const absB = toAbs(projectRoot, fB);
          // domainB has a file that starts with domainA's path (i.e. is inside A's directory)
          if (absB !== absA && (absB.startsWith(absA + path.sep) || absB + path.sep === absA + path.sep)) {
            if (!result.has(domainB)) result.set(domainB, new Set());
            result.get(domainB).add(domainA);
          }
        }
      }
    }
  }
  return result;
}

/**
 * Pass 2: require() scanning.
 * @param {string} projectRoot
 * @param {object} indexJson
 * @param {Map<string, string>} pathMap  absPath → domainKey
 * @returns {Map<string, Set<string>>}  domainKey → Set<dependsOnDomainKey>
 */
function passRequireScan(projectRoot, indexJson, pathMap) {
  const result = new Map();
  const domains = Object.entries(indexJson).filter(([k]) => k !== '$schema');

  for (const [domain, entry] of domains) {
    if (!Array.isArray(entry.files)) continue;
    const jsFiles = collectJsFiles(projectRoot, entry.files);

    for (const jsFile of jsFiles) {
      let src;
      try {
        src = fs.readFileSync(jsFile, 'utf8');
      } catch {
        continue;
      }

      let match;
      REQUIRE_RE.lastIndex = 0;
      while ((match = REQUIRE_RE.exec(src)) !== null) {
        const specifier = match[1];
        // Only resolve relative requires — skip bare module names (node_modules)
        if (!specifier.startsWith('.')) continue;

        const resolved = path.resolve(path.dirname(jsFile), specifier);

        // Try the path as-is, then with .js extension
        for (const candidate of [resolved, resolved + '.js']) {
          if (pathMap.has(candidate)) {
            const depDomain = pathMap.get(candidate);
            if (depDomain !== domain) {
              if (!result.has(domain)) result.set(domain, new Set());
              result.get(domain).add(depDomain);
            }
            break;
          }
        }
      }
    }
  }
  return result;
}

/**
 * Merge two Maps of Sets.
 * @param {Map<string, Set<string>>} a
 * @param {Map<string, Set<string>>} b
 * @returns {Map<string, Set<string>>}
 */
function mergeMaps(a, b) {
  const merged = new Map(a);
  for (const [key, set] of b) {
    if (!merged.has(key)) merged.set(key, new Set());
    for (const v of set) merged.get(key).add(v);
  }
  return merged;
}

/**
 * Infer dependsOn relationships for all domains in indexJson.
 *
 * @param {string} projectRoot  Absolute path to the project root.
 * @param {object} indexJson    Parsed .claude/ontology/index.json.
 * @returns {object}  Map of domainKey → string[] of suggested new dependsOn entries.
 *                    Only includes domains where new dependencies were found
 *                    (not already in the existing dependsOn array).
 */
function inferDependsOn(projectRoot, indexJson) {
  const pathMap = buildPathMap(projectRoot, indexJson);

  const overlapMap = passPathOverlap(projectRoot, indexJson);
  const requireMap = passRequireScan(projectRoot, indexJson, pathMap);
  const combined = mergeMaps(overlapMap, requireMap);

  const suggestions = {};
  for (const [domain, depSet] of combined) {
    const existing = indexJson[domain]?.dependsOn || [];
    const newDeps = [...depSet].filter(d => !existing.includes(d)).sort();
    if (newDeps.length > 0) {
      suggestions[domain] = newDeps;
    }
  }
  return suggestions;
}

/**
 * Walk the *already recorded* dependsOn graph from `domainKey`, breadth-first,
 * up to `depth` hops. Pure in-memory traversal — no file I/O, no inference
 * (see the header comment above for how this differs from inferDependsOn()).
 *
 * @param {string} domainKey - starting domain.
 * @param {object} domainGraph - map of domainKey -> { dependsOn?: string[], ... }.
 *   Accepts either the flat index.json shape or the merged domainMap produced
 *   by ontology-routing's loadOntologyMaps — both expose `.dependsOn` per entry.
 * @param {object} [options]
 * @param {number} [options.depth=1] - number of hops to traverse.
 * @param {'forward'|'reverse'} [options.direction='forward'] - 'forward' follows
 *   each domain's own dependsOn (upstream); 'reverse' follows edges backwards
 *   (classic blast-radius / impact analysis).
 * @returns {string[]} Domain keys reached, de-duplicated, in BFS discovery
 *   order, excluding `domainKey` itself.
 */
function traverseDependsOn(domainKey, domainGraph, options = {}) {
  if (!domainKey || !domainGraph || typeof domainGraph !== 'object') return [];

  const depth = Number.isInteger(options.depth) && options.depth > 0 ? options.depth : 1;
  const direction = options.direction === 'reverse' ? 'reverse' : 'forward';

  let reverseMap = null;
  if (direction === 'reverse') {
    reverseMap = new Map();
    for (const [key, entry] of Object.entries(domainGraph)) {
      if (!entry || !Array.isArray(entry.dependsOn)) continue;
      for (const dep of entry.dependsOn) {
        if (!reverseMap.has(dep)) reverseMap.set(dep, []);
        reverseMap.get(dep).push(key);
      }
    }
  }

  const getNeighbors = (key) => {
    if (direction === 'reverse') return reverseMap.get(key) || [];
    const entry = domainGraph[key];
    return entry && Array.isArray(entry.dependsOn) ? entry.dependsOn : [];
  };

  const visited = new Set([domainKey]);
  const order = [];
  let frontier = [domainKey];

  for (let hop = 0; hop < depth && frontier.length > 0; hop++) {
    const next = [];
    for (const key of frontier) {
      for (const neighbor of getNeighbors(key)) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          order.push(neighbor);
          next.push(neighbor);
        }
      }
    }
    frontier = next;
  }

  return order;
}

module.exports = {
  inferDependsOn,
  passPathOverlap,
  passRequireScan,
  collectJsFiles,
  traverseDependsOn,
};
