#!/usr/bin/env node
/**
 * Validate agent markdown files:
 *  - required frontmatter exists
 *  - every agent contains the standard contract sections
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
const CONTRACT_SECTION_RULES = {
  'Not Do': [
    {
      message: 'Not Do must include a concrete prohibition',
      pattern: /(?:\b(?:do not|don't|never|avoid|without approval|without evidence)\b|금지|하지\s*말|하지마|하지\s*않|않는다|불가)/i,
    },
  ],
  'Decision Policy': [
    {
      message: 'Decision Policy must state autonomous decision scope',
      pattern: /(?:\b(?:you may|may choose|may classify|may fix|may select|may infer|may assign|may tune|may remove|may propose|may adjust|may define)\b|혼자\s*결정|자율|스스로|결정\s*가능|선택\s*가능)/i,
    },
    {
      message: 'Decision Policy must state human approval boundary',
      pattern: /(?:\b(?:human approval|approval is required|ask for human approval|explicit approval)\b|사람\s*승인|사용자\s*승인|승인\s*필요|명시적\s*승인)/i,
    },
    {
      message: 'Decision Policy must state escalation criteria',
      pattern: /(?:\bescalate\b|에스컬레이트|에스컬레이션|상위\s*보고|사람에게\s*확인|승격)/i,
    },
  ],
  'Execution Policy': [
    {
      message: 'Execution Policy must state start or checkpoint criteria',
      pattern: /(?:\b(?:start|before|capture|read|inspect|review|run|collect|confirm|inventory|scan|establish|resolve)\b|시작|전에|확인|검증|점검|체크포인트|실행\s*전|수집)/i,
    },
    {
      message: 'Execution Policy must state evidence or blocked completion criteria',
      pattern: /(?:\b(?:evidence|verdict|blocked|risk|handoff|next action|pass\/fail|score|recommended path|checking|source quality)\b|증거|근거|차단|막힘|보류|리스크|핸드오프|다음\s*액션|완료\s*금지)/i,
    },
  ],
  'Style': [
    {
      message: 'Style must state reporting or communication style',
      pattern: /(?:\b(?:concise|terse|concrete|evidence|specific|operational|pragmatic|severity|implementation|direct|clear|brief|precise|findings|diagnostic|compiler|audit|metric|reproducible|operator|strict|focused|exact|minimal|framework|idiomatic|runtime|remediation|behavior)\b|간결|구체|명확|보고|톤|말투|직접|정확|짧게|핵심)/i,
    },
  ],
};

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

function extractHeadingSection(body, heading) {
  const lines = String(body || '').split(/\r?\n/);
  const pattern = new RegExp(`^##\\s+${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'i');
  const startIndex = lines.findIndex(line => pattern.test(line.trim()));
  if (startIndex === -1) return '';

  let endIndex = lines.length;
  for (let index = startIndex + 1; index < lines.length; index++) {
    if (/^#{1,2}\s+/.test(lines[index])) {
      endIndex = index;
      break;
    }
  }

  return lines.slice(startIndex + 1, endIndex).join('\n').trim();
}

function validateContractSectionQuality(fileName, body, section) {
  const errors = [];
  const content = extractHeadingSection(body, section);
  if (!content) {
    errors.push(`ERROR: ${fileName} - Empty contract section: ${section}`);
    return errors;
  }

  const rules = CONTRACT_SECTION_RULES[section] || [];
  for (const rule of rules) {
    if (!rule.pattern.test(content)) {
      errors.push(`ERROR: ${fileName} - ${rule.message}`);
    }
  }

  return errors;
}

function validateAgentFile(filePath) {
  const fileName = path.basename(filePath);
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
    errors.push(`ERROR: ${message}`);
  }
  for (const section of CONTRACT_SECTIONS.filter(section => !missingSections.includes(section))) {
    errors.push(...validateContractSectionQuality(fileName, body, section));
  }

  return { file: fileName, errors, warnings };
}

function validateAgents(options = {}) {
  const agentDirs = options.agentDirs || DEFAULT_AGENT_DIRS;
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
      const result = validateAgentFile(path.join(agentDir, file));
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
  CONTRACT_SECTION_RULES,
  extractFrontmatter,
  validateAgentFile,
  validateAgents,
};

if (require.main === module) {
  runCli();
}
