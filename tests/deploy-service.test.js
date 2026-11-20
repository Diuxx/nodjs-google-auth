import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const gitBash = 'C:\\Program Files\\Git\\bin\\bash.exe';
const bash = process.platform === 'win32' && existsSync(gitBash) ? gitBash : 'bash';

test('Deployment prompts preserve existing applications and configure Drive options', t => {
  const available = spawnSync(bash, ['--version'], { encoding: 'utf8' });
  if (available.error?.code === 'ENOENT') {
    t.skip('Bash is required to exercise the deployment prompts');
    return;
  }
  assert.equal(available.status, 0, available.stderr);
  const source = readFileSync(new URL('../ops/deploy-service.sh', import.meta.url), 'utf8');
  const start = source.indexOf('prompt_boolean() {');
  const end = source.indexOf('\nprompt_allowed_emails() {', start);
  assert.ok(start !== -1 && end > start);
  const script = `
set -euo pipefail
info() { printf '[INFO] %s\\n' "$*"; }
warn() { printf '[WARN] %s\\n' "$*"; }
fail() { printf '[ERROR] %s\\n' "$*" >&2; exit 1; }
DOMAIN=auth.example.org
${source.slice(start, end)}
prompt_client_apps '' <<'INPUT'
pecule
https://pecule.example.org
invalid
y
yes
batch
https://batch.example.org
n


INPUT
printf 'CREATED=%s\\n' "$REPLY"
existing='[{"id":"pecule","origins":["https://pecule.example.org"],"requiresDrive":true,"multiple":true}]'
prompt_client_apps "$existing" <<'INPUT'

INPUT
printf 'PRESERVED=%s\\n' "$REPLY"
`;
  const result = spawnSync(bash, ['-c', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const created = result.stdout.match(/^CREATED=(.+)$/m);
  const preserved = result.stdout.match(/^PRESERVED=(.+)$/m);
  assert.ok(created && preserved);
  assert.deepEqual(JSON.parse(created[1]), [
    { id: 'pecule', origins: ['https://pecule.example.org'], requiresDrive: true, multiple: true },
    { id: 'batch', origins: ['https://batch.example.org'], requiresDrive: false, multiple: false }
  ]);
  assert.deepEqual(JSON.parse(preserved[1]), [
    { id: 'pecule', origins: ['https://pecule.example.org'], requiresDrive: true, multiple: true }
  ]);
});
