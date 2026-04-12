'use strict';

const fs = require('fs');
const path = require('path');

const MANIFEST_PATHS = {
  packageJson: 'package.json',
  codexPlugin: path.join('.codex-plugin', 'plugin.json'),
  claudeMarketplace: path.join('.claude-plugin', 'marketplace.json'),
};

function readJson(rootDir, relativePath) {
  const filePath = path.join(rootDir, relativePath);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readReleaseManifestVersions(rootDir) {
  const packageJson = readJson(rootDir, MANIFEST_PATHS.packageJson);
  const codexPlugin = readJson(rootDir, MANIFEST_PATHS.codexPlugin);
  const claudeMarketplace = readJson(rootDir, MANIFEST_PATHS.claudeMarketplace);

  return {
    packageVersion: packageJson.version || null,
    codexPluginVersion: codexPlugin.version || null,
    marketplaceMetadataVersion: claudeMarketplace?.metadata?.version || null,
    marketplacePluginVersions: Array.isArray(claudeMarketplace?.plugins)
      ? claudeMarketplace.plugins.map((plugin, index) => ({
          index,
          name: plugin && plugin.name ? plugin.name : `plugins[${index}]`,
          version: plugin && plugin.version ? plugin.version : null,
        }))
      : [],
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

module.exports = {
  MANIFEST_PATHS,
  readReleaseManifestVersions,
  findReleaseManifestVersionMismatches,
};
