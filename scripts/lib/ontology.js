'use strict';

const fs = require('fs');
const path = require('path');
const {
  buildOntologyDetailFragment,
  inferDomainFromDetailPath,
  mergeOntologyDetail,
  parseDesignContract,
  readContractFile,
} = require('./design-contract');

// ─── filesystem helpers ──────────────────────────────────────────────────────

function resolveOntologyDir() {
  const cwdDir = path.join(process.cwd(), '.claude', 'ontology');
  if (fs.existsSync(cwdDir)) return cwdDir;

  const pluginRoot = process.env.CLAUDE_PLUGIN_ROOT;
  if (pluginRoot) {
    const pluginDir = path.join(pluginRoot, '.claude', 'ontology');
    if (fs.existsSync(pluginDir)) return pluginDir;
  }

  const attempted = pluginRoot
    ? `${cwdDir}, ${path.join(pluginRoot, '.claude', 'ontology')}`
    : cwdDir;
  throw new Error(`Ontology directory not found (checked: ${attempted})`);
}

function loadIndex() {
  const ontologyDir = resolveOntologyDir();
  const indexPath = path.join(ontologyDir, 'index.json');
  try {
    const raw = fs.readFileSync(indexPath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    const reason = err.code === 'ENOENT' ? 'index.json not found' : err.message;
    throw new Error(`Failed to load ontology index: ${reason}`);
  }
}

function domainKeys(index) {
  return Object.keys(index).filter(key => key.startsWith('domain_'));
}

// ─── public API ─────────────────────────────────────────────────────────────

function listKeys() {
  const index = loadIndex();
  return domainKeys(index);
}

function listSummary() {
  const index = loadIndex();
  return domainKeys(index).map(key => {
    const entry = index[key] || {};
    const summary = typeof entry.summary === 'string' && entry.summary.trim()
      ? entry.summary
      : '(no summary)';
    return { key, summary };
  });
}

function pickFields(entry, fields = []) {
  if (!fields.length) return { ...entry };
  return fields.reduce((acc, field) => {
    if (Object.prototype.hasOwnProperty.call(entry, field)) {
      return { ...acc, [field]: entry[field] };
    }
    return acc;
  }, {});
}

function queryDomain(domainId, fields = []) {
  const index = loadIndex();
  const entry = index[domainId];
  if (!entry) throw new Error('domain not found');
  return pickFields(entry, fields);
}

function queryFile(filePath) {
  const index = loadIndex();
  for (const key of domainKeys(index)) {
    const entry = index[key];
    if (Array.isArray(entry.files) && entry.files.includes(filePath)) {
      return { ...entry };
    }
  }
  throw new Error('domain not found');
}

function resolveWorkingPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function promoteContract(options = {}) {
  if (!options.contractFile) {
    throw new Error('promote-contract requires --contract-file <path>');
  }

  const contractFile = resolveWorkingPath(options.contractFile);
  const contract = parseDesignContract(readContractFile(contractFile));
  const detailFile = options.detailFile ? resolveWorkingPath(options.detailFile) : '';
  const domain = options.domain || inferDomainFromDetailPath(detailFile);
  const fragment = buildOntologyDetailFragment(contract, {
    contractFile: options.contractFile,
    source: options.source || options.contractFile,
    summary: options.summary,
    domain,
    version: options.version || '',
  });

  const existing = detailFile && fs.existsSync(detailFile)
    ? readJsonFile(detailFile)
    : {};
  const merged = detailFile ? mergeOntologyDetail(existing, fragment) : fragment;

  if (options.write) {
    if (!detailFile) {
      throw new Error('promote-contract --write requires --detail-file <path>');
    }
    fs.mkdirSync(path.dirname(detailFile), { recursive: true });
    fs.writeFileSync(detailFile, JSON.stringify(merged, null, 2) + '\n', 'utf8');
  }

  return merged;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function cli(argv) {
  const [cmd, ...rest] = argv;

  try {
    if (cmd === 'keys') {
      listKeys().forEach(k => console.log(k));
      return;
    }

    if (cmd === 'summary') {
      listSummary().forEach(({ key, summary }) => console.log(`${key}: ${summary}`));
      return;
    }

    if (cmd === 'query') {
      const opts = parseFlags(rest);
      if (opts.domain && opts.file) {
        throw new Error('use either --domain or --file, not both');
      }
      if (!opts.domain && !opts.file) {
        throw new Error('query requires --domain <id> or --file <path>');
      }

      const fields = opts.fields
        ? opts.fields.split(',').map(f => f.trim()).filter(Boolean)
        : [];

      if (opts.domain) {
        const result = queryDomain(opts.domain, fields);
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      const result = queryFile(opts.file);
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    if (cmd === 'promote-contract') {
      const opts = parseFlags(rest);
      const result = promoteContract({
        contractFile: opts['contract-file'],
        detailFile: opts['detail-file'],
        domain: opts.domain,
        source: opts.source,
        summary: opts.summary,
        version: opts.version,
        write: Boolean(opts.write),
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    throw new Error('Usage: ontology.js <keys|summary|query|promote-contract> [--flag value ...]');
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

function parseFlags(args) {
  const result = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2);
      result[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true;
    }
  }
  return result;
}

module.exports = {
  resolveOntologyDir,
  queryDomain,
  queryFile,
  listKeys,
  listSummary,
  promoteContract,
};

if (require.main === module) {
  cli(process.argv.slice(2));
}
