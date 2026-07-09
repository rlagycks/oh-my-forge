#!/usr/bin/env node

const os = require('os');
const path = require('path');
const { buildDoctorReport } = require('./lib/install-lifecycle');
const { SUPPORTED_INSTALL_TARGETS } = require('./lib/install-manifests');
const { findDuplicateHookRegistrations } = require('./lib/hook-duplicate-check');

function showHelp(exitCode = 0) {
  console.log(`
Usage: node scripts/doctor.js [--target <${SUPPORTED_INSTALL_TARGETS.join('|')}>] [--json]

Diagnose drift and missing managed files for OMF install-state in the current context.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const parsed = {
    targets: [],
    json: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--target') {
      parsed.targets.push(args[index + 1] || null);
      index += 1;
    } else if (arg === '--json') {
      parsed.json = true;
    } else if (arg === '--help' || arg === '-h') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

function statusLabel(status) {
  if (status === 'ok') {
    return 'OK';
  }

  if (status === 'warning') {
    return 'WARNING';
  }

  if (status === 'error') {
    return 'ERROR';
  }

  return status.toUpperCase();
}

function printHuman(report) {
  if (report.results.length === 0) {
    console.log('No install-state files found for the current home/project context.');
    return;
  }

  console.log('Doctor report:\n');
  for (const result of report.results) {
    console.log(`- ${result.adapter.id}`);
    console.log(`  Status: ${statusLabel(result.status)}`);
    console.log(`  Install-state: ${result.installStatePath}`);

    if (result.issues.length === 0) {
      console.log('  Issues: none');
      continue;
    }

    for (const issue of result.issues) {
      console.log(`  - [${issue.severity}] ${issue.code}: ${issue.message}`);
    }
  }

  console.log(`\nSummary: checked=${report.summary.checkedCount}, ok=${report.summary.okCount}, warnings=${report.summary.warningCount}, errors=${report.summary.errorCount}`);
}

function buildDuplicateHookIssue(scriptNames) {
  return {
    severity: 'warning',
    code: 'duplicate-hook-registration',
    message: `${scriptNames.length} hook script(s) are registered both by the oh-my-forge plugin (hooks/hooks.json) and manually in ~/.claude/settings.json, which causes them to run twice per event (e.g. SessionStart context injected twice). Remove the manual entries from ~/.claude/settings.json and let the plugin manage them.`,
    scripts: scriptNames,
  };
}

function appendDuplicateHookCheck(report, { repoRoot, homeDir }) {
  const duplicateCheck = findDuplicateHookRegistrations({ repoRoot, homeDir });
  if (!duplicateCheck) return report;

  const issues = duplicateCheck.duplicateScripts.length > 0
    ? [buildDuplicateHookIssue(duplicateCheck.duplicateScripts)]
    : [];

  report.results.push({
    adapter: { id: 'session-start-duplicate-check', target: 'diagnostics', kind: 'diagnostic' },
    targetRoot: homeDir,
    installStatePath: path.join(homeDir, '.claude', 'settings.json'),
    exists: true,
    status: issues.length > 0 ? 'warning' : 'ok',
    issues,
  });

  report.summary.checkedCount += 1;
  if (issues.length > 0) {
    report.summary.warningCount += issues.length;
  } else {
    report.summary.okCount += 1;
  }

  return report;
}

function main() {
  try {
    const options = parseArgs(process.argv);
    if (options.help) {
      showHelp(0);
    }

    const repoRoot = path.join(__dirname, '..');
    const homeDir = process.env.HOME || os.homedir();

    const report = buildDoctorReport({
      repoRoot,
      homeDir,
      projectRoot: process.cwd(),
      targets: options.targets,
    });
    appendDuplicateHookCheck(report, { repoRoot, homeDir });
    const hasIssues = report.summary.errorCount > 0 || report.summary.warningCount > 0;

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      printHuman(report);
    }

    process.exitCode = hasIssues ? 1 : 0;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

main();
