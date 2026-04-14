#!/usr/bin/env node
/**
 * Validate agent markdown files:
 *  - required frontmatter exists
 *  - core agents contain the standard contract sections
 *  - non-core agents are warned so the rollout can remain incremental
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_AGENT_DIRS = [path.join(__dirname, '../../agents')];
const REQUIRED_FIELDS = ['name', 'description', 'model', 'tools'];
const VALID_MODELS = ['haiku', 'sonnet', 'opus'];
const CONTRACT_SECTIONS = [
  'Mission',
  'Not Do',
  'Success',
  'Decision Policy',
  'Execution Policy',
  'Style',
];
const STRICT_CONTRACT_AGENTS = [
  'architect',
  'planner',
  'tdd-guide',
  'code-reviewer',
  'security-reviewer',
  'loop-operator',
  'harness-optimizer',
];

function extractFrontmatter(content) {
  const cleanContent = content.replace(/^\uFEFF/, '');
  const match = cleanContent.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const frontmatter = {};
  const lines = match[1].split(/\r?\n/);
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      frontmatter[key] = value;
    }
  }
  return frontmatter;
}

function extractBody(content) {
  const cleanContent = content.replace(/^\uFEFF/, '');
  const match = cleanContent.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?([\s\S]*)$/);
  return match ? match[1] : cleanContent;
}

function hasHeading(body, heading) {
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'mi');
  return pattern.test(body);
}

function validateAgentFile(filePath, options = {}) {
  const strictContractAgents = options.strictContractAgents || STRICT_CONTRACT_AGENTS;
  const fileName = path.basename(filePath);
  const agentName = fileName.replace(/\.md$/, '');
  const errors = [];
  const warnings = [];

  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return {
      file: fileName,
      errors: [`ERROR: ${fileName} - ${err.message}`],
      warnings,
    };
  }

  const frontmatter = extractFrontmatter(content);
  if (!frontmatter) {
    return {
      file: fileName,
      errors: [`ERROR: ${fileName} - Missing frontmatter`],
      warnings,
    };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!frontmatter[field] || (typeof frontmatter[field] === 'string' && !frontmatter[field].trim())) {
      errors.push(`ERROR: ${fileName} - Missing required field: ${field}`);
    }
  }

  if (frontmatter.model && !VALID_MODELS.includes(frontmatter.model)) {
    errors.push(`ERROR: ${fileName} - Invalid model '${frontmatter.model}'. Must be one of: ${VALID_MODELS.join(', ')}`);
  }

  const body = extractBody(content);
  const missingSections = CONTRACT_SECTIONS.filter(section => !hasHeading(body, section));
  if (missingSections.length > 0) {
    const message = `${fileName} - Missing contract section(s): ${missingSections.join(', ')}`;
    if (strictContractAgents.includes(agentName)) {
      errors.push(`ERROR: ${message}`);
    } else {
      warnings.push(`WARN: ${message}`);
    }
  }

  return { file: fileName, errors, warnings };
}

function validateAgents(options = {}) {
  const agentDirs = options.agentDirs || DEFAULT_AGENT_DIRS;
  const strictContractAgents = options.strictContractAgents || STRICT_CONTRACT_AGENTS;
  const errors = [];
  const warnings = [];
  let filesValidated = 0;

  for (const agentDir of agentDirs) {
    if (!fs.existsSync(agentDir)) {
      continue;
    }

    const files = fs.readdirSync(agentDir).filter(f => f.endsWith('.md'));
    filesValidated += files.length;

    for (const file of files) {
      const result = validateAgentFile(path.join(agentDir, file), { strictContractAgents });
      errors.push(...result.errors);
      warnings.push(...result.warnings);
    }
  }

  return {
    valid: errors.length === 0,
    filesValidated,
    errors,
    warnings,
  };
}

function runCli() {
  const result = validateAgents();

  for (const warning of result.warnings) {
    console.warn(warning);
  }
  for (const error of result.errors) {
    console.error(error);
  }

  if (!result.valid) {
    process.exit(1);
  }

  console.log(`Validated ${result.filesValidated} agent files`);
}

module.exports = {
  CONTRACT_SECTIONS,
  STRICT_CONTRACT_AGENTS,
  extractFrontmatter,
  validateAgentFile,
  validateAgents,
};

if (require.main === module) {
  runCli();
}
