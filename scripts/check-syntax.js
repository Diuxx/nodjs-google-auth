import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function jsFiles(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => {
    const full = join(folder, entry.name);
    return entry.isDirectory() ? jsFiles(full) : entry.name.endsWith('.js') ? [full] : [];
  });
}

let failed = false;
for (const file of [...jsFiles('src'), ...jsFiles('scripts'), ...jsFiles('tests'), ...jsFiles('examples')]) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}
if (failed) process.exitCode = 1;
else process.stdout.write('Syntaxe JavaScript valide.\n');
