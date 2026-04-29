'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_PATHS = {
  packageJson: 'package.json',
  packageLock: 'package-lock.json',
  agentYaml: 'agent.yaml',
  agentsDoc: 'AGENTS.md',
  codexPlugin: '.codex-plugin/plugin.json',
  claudeMarketplace: '.claude-plugin/marketplace.json',
};

const REQUIRED_PACKAGED_PATHS = [
  '.claude-plugin/README.md',
  '.codex-plugin/README.md',
];

function readJson(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readOptionalText(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return fs.readFileSync(filePath, 'utf8');
}

function normalizePackageFileEntry(entry) {
  if (typeof entry !== 'string' || entry.length === 0) {
    return null;
  }

  const normalized = entry.replace(/\\/g, '/');
  return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
}

function readAgentYamlVersion(rootDir) {
  const content = readOptionalText(rootDir, MANIFEST_PATHS.agentYaml);
  if (content === null) {
    return null;
  }

  const match = content.match(/^version:\s*"?([^"\n]+)"?\s*$/m);
  return match ? match[1].trim() : null;
}

function readAgentsDocVersion(rootDir) {
  const content = readOptionalText(rootDir, MANIFEST_PATHS.agentsDoc);
  if (content === null) {
    return null;
  }

  const match = content.match(/^\*\*Version:\*\*\s*([^\s]+)\s*$/m);
  return match ? match[1].trim() : null;
}

function readReleaseManifestVersions(rootDir) {
  const packageJson = readJson(rootDir, MANIFEST_PATHS.packageJson);
  const packageLock = readJson(rootDir, MANIFEST_PATHS.packageLock);
  const codexPlugin = readJson(rootDir, MANIFEST_PATHS.codexPlugin);
  const claudeMarketplace = readJson(rootDir, MANIFEST_PATHS.claudeMarketplace);

  return {
    packageVersion: packageJson.version || null,
    packageLockVersion: packageLock.version || null,
    packageLockPackageVersion: packageLock?.packages?.['']?.version || null,
    agentYamlVersion: readAgentYamlVersion(rootDir),
    agentsDocVersion: readAgentsDocVersion(rootDir),
    codexPluginVersion: codexPlugin.version || null,
    marketplaceMetadataVersion: claudeMarketplace?.metadata?.version || null,
    marketplacePluginVersions: Array.isArray(claudeMarketplace?.plugins)
      ? claudeMarketplace.plugins.map((plugin, index) => ({
          index,
          name: plugin && plugin.name ? plugin.name : `plugins[${index}]`,
          version: plugin && plugin.version ? plugin.version : null,
        }))
      : [],
    packagedPaths: REQUIRED_PACKAGED_PATHS.map(relativePath => ({
      relativePath,
      listed: Array.isArray(packageJson.files)
        && packageJson.files
          .map(normalizePackageFileEntry)
          .filter(Boolean)
          .includes(relativePath),
      exists: fs.existsSync(path.join(rootDir, relativePath)),
    })),
  };
}

function findReleaseManifestVersionMismatches(snapshot) {
  const mismatches = [];
  const expectedVersion = snapshot && snapshot.packageVersion ? snapshot.packageVersion : null;

  if (!expectedVersion) {
    mismatches.push('package.json is missing a version field');
    return mismatches;
  }

  if (snapshot.codexPluginVersion !== expectedVersion) {
    mismatches.push(
      `.codex-plugin/plugin.json version ${String(snapshot.codexPluginVersion)} does not match package.json version ${expectedVersion}`
    );
  }

  if (snapshot.packageLockVersion !== expectedVersion) {
    mismatches.push(
      `package-lock.json version ${String(snapshot.packageLockVersion)} does not match package.json version ${expectedVersion}`
    );
  }

  if (snapshot.packageLockPackageVersion !== expectedVersion) {
    mismatches.push(
      `package-lock.json packages[""] version ${String(snapshot.packageLockPackageVersion)} does not match package.json version ${expectedVersion}`
    );
  }

  if (snapshot.agentYamlVersion !== expectedVersion) {
    mismatches.push(
      `agent.yaml version ${String(snapshot.agentYamlVersion)} does not match package.json version ${expectedVersion}`
    );
  }

  if (snapshot.agentsDocVersion !== expectedVersion) {
    mismatches.push(
      `AGENTS.md version ${String(snapshot.agentsDocVersion)} does not match package.json version ${expectedVersion}`
    );
  }

  if (snapshot.marketplaceMetadataVersion !== expectedVersion) {
    mismatches.push(
      `.claude-plugin/marketplace.json metadata.version ${String(snapshot.marketplaceMetadataVersion)} does not match package.json version ${expectedVersion}`
    );
  }

  if (snapshot.marketplacePluginVersions.length === 0) {
    mismatches.push('.claude-plugin/marketplace.json has no plugins[] entries');
    return mismatches;
  }

  for (const plugin of snapshot.marketplacePluginVersions) {
    if (plugin.version !== expectedVersion) {
      mismatches.push(
        `.claude-plugin/marketplace.json plugins[${plugin.index}] (${plugin.name}) version ${String(plugin.version)} does not match package.json version ${expectedVersion}`
      );
    }
  }

  return mismatches;
}

function findMissingPackagedPaths(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.packagedPaths)) {
    return [];
  }

  return snapshot.packagedPaths
    .flatMap((entry) => {
      if (!entry.listed) {
        return `${entry.relativePath} is required in package.json files but is not listed`;
      }

      if (!entry.exists) {
        return `${entry.relativePath} is listed in package.json files but does not exist`;
      }

      return [];
    });
}

module.exports = {
  MANIFEST_PATHS,
  REQUIRED_PACKAGED_PATHS,
  readReleaseManifestVersions,
  findReleaseManifestVersionMismatches,
  findMissingPackagedPaths,
};
