const fs = require('fs');
const path = require('path');

const {
  createInstallTargetAdapter,
  createRemappedOperation,
} = require('./helpers');

module.exports = createInstallTargetAdapter({
  id: 'codex-home',
  target: 'codex',
  kind: 'home',
  rootSegments: ['.codex'],
  installStatePathSegments: ['ecc-install-state.json'],
  nativeRootRelativePath: '.codex',
  planOperations(input, adapter) {
    const modules = Array.isArray(input.modules)
      ? input.modules
      : (input.module ? [input.module] : []);
    const {
      repoRoot,
      projectRoot,
      homeDir,
    } = input;
    const planningInput = {
      repoRoot,
      projectRoot,
      homeDir,
    };
    const targetRoot = adapter.resolveRoot(planningInput);

    return modules.flatMap(module => {
      const paths = Array.isArray(module.paths) ? module.paths : [];
      return paths.flatMap(sourceRelativePath => {
        if (sourceRelativePath !== '.codex') {
          return [adapter.createScaffoldOperation(module.id, sourceRelativePath, planningInput)];
        }

        const codexDir = path.join(repoRoot || '', '.codex');
        if (!repoRoot || !fs.existsSync(codexDir) || !fs.statSync(codexDir).isDirectory()) {
          return [];
        }

        return fs.readdirSync(codexDir, { withFileTypes: true })
          .sort((left, right) => left.name.localeCompare(right.name))
          .flatMap(entry => {
            if (entry.name === 'hooks.json' || entry.name === 'config.user.toml') {
              return [];
            }

            if (entry.name === 'config.toml') {
              return [
                createRemappedOperation(
                  adapter,
                  module.id,
                  path.join('.codex', 'config.user.toml'),
                  path.join(targetRoot, 'config.toml')
                ),
              ];
            }

            return [
              adapter.createScaffoldOperation(
                module.id,
                path.join('.codex', entry.name),
                planningInput
              ),
            ];
          });
      });
    });
  },
});
