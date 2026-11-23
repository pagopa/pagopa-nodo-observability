import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../../.github/workflows/release_deploy.yml', import.meta.url), 'utf8');
const deployJob = workflow.match(/^  deploy:\n([\s\S]*?)(?=^  [a-z_]+:|(?![\s\S]))/m)?.[1];

test('deploy selects the private runner for the resolved environment', () => {
  assert.ok(deployJob, 'deploy job is present');
  assert.match(deployJob, /runs-on:\s*\[\s*self-hosted-job,\s*['"]?\$\{\{\s*needs\.setup\.outputs\.environment\s*\}\}['"]?\s*\]/);
  assert.match(workflow, /if:.*inputs\.environment == null.*inputs\.environment == ''/);
  assert.match(workflow, /echo "ENVIRONMENT=dev" >> \$GITHUB_ENV/);
});

test('root static pages sync does not delete the deployed UI', () => {
  assert.ok(deployJob, 'deploy job is present');
  const staticSync = deployJob.split('\n').find((line) => line.includes('az storage blob sync') && line.includes('"./static"'));
  assert.ok(staticSync, 'static pages sync is present');
  assert.match(staticSync, /--delete-destination(?:=|\s+)false\b/);
  assert.match(staticSync, /--container\s+'\$web'/);
  assert.doesNotMatch(staticSync, /(?:--destination(?:=|\s+)|\s-d\s+)/);
});

test('both blob sync steps run Azure CLI directly on the private runner', () => {
  assert.ok(deployJob, 'deploy job is present');
  for (const stepName of ['Deploy ${{ needs.setup.outputs.environment }}', 'Deploy static pages ${{ needs.setup.outputs.environment }}']) {
    const step = deployJob.split(`      - name: ${stepName}\n`)[1]?.split('\n      - name:')[0];
    assert.ok(step, `${stepName} step is present`);
    assert.match(step, /run: \|/);
    assert.match(step, /az storage blob sync/);
    assert.match(step, /AZURE_STORAGE_CONNECTION_STRING:\s*\$\{\{\s*secrets\.BLOB_CONNECTION_STRING\s*\}\}/);
    assert.match(step, /AZURE_STORAGE_ACCOUNT:\s*\$\{\{\s*vars\.STORAGE_ACCOUNT\s*\}\}/);
    assert.doesNotMatch(step, /^\s+uses:\s*azure\/CLI@/im);
  }
});
