import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const read = (name) => readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), 'utf8');
const aks = read('release_deploy.yml');
const storage = read('release_deploy.yml');
const job = (name) => aks.match(new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [a-z_]+:|^#|(?![\\s\\S]))`, 'm'))?.[1];
const triggers = (workflow) => workflow.match(/^on:\n([\s\S]*?)(?=^\S)/m)?.[1] ?? '';

test('only the storage workflow releases merged pull requests', () => {
  assert.match(triggers(storage), /^ {2}pull_request:/m);
  assert.doesNotMatch(triggers(aks), /^ {2}pull_request:/m);
  assert.match(triggers(aks), /^ {2}workflow_dispatch:/m);
});

test('release and image wait for the AKS prerequisites check', () => {
  const preflight = job('preflight');
  assert.ok(preflight, 'preflight job is present');
  assert.match(preflight, /helm\/Chart\.yaml/);
  assert.match(preflight, /helm\/values-\$\{ENVIRONMENT\}\.yaml/);
  for (const name of ['NAMESPACE', 'CLUSTER_NAME', 'CLUSTER_RESOURCE_GROUP']) {
    assert.match(preflight, new RegExp(`${name}: \\$\\{\\{ vars\\.${name} \\}\\}`));
  }
  assert.match(job('release'), /needs: \[ setup, preflight \]/);
  assert.match(job('image'), /needs\.preflight\.result == 'success'/);
});

test('AKS image keeps the default Entra redirect URI', () => {
  const image = job('image');
  assert.ok(image, 'image job is present');
  assert.match(image, /ENTRA_CLIENT_ID=\$\{\{ vars\.ENTRA_CLIENT_ID \}\}/);
  assert.doesNotMatch(image, /ENTRA_REDIRECT_URI=/);
});

const stepScript = (jobName, stepName) => {
  const lines = job(jobName).split('\n');
  const stepStart = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  const start = lines.findIndex((line, index) => index > stepStart && line.trim() === 'run: |') + 1;
  const end = lines.findIndex((line, index) => index >= start && /^ {6}- name:/.test(line));
  return lines
    .slice(start, end === -1 ? undefined : end)
    .map((line) => line.slice(10))
    .join('\n');
};

const runStep = (script, helmFiles, environment = 'dev') => {
  const dir = mkdtempSync(join(tmpdir(), 'aks-preflight-'));
  const output = join(dir, 'github-output');
  try {
    mkdirSync(join(dir, 'helm'));
    writeFileSync(output, '');
    for (const [name, content] of Object.entries(helmFiles)) writeFileSync(join(dir, 'helm', name), content);
    execFileSync('bash', ['-c', script], {
      cwd: dir,
      stdio: 'pipe',
      env: {
        ...process.env,
        ENVIRONMENT: environment,
        GITHUB_OUTPUT: output,
        NAMESPACE: 'ns',
        CLUSTER_NAME: 'aks',
        CLUSTER_RESOURCE_GROUP: 'rg',
      },
    });
    return { status: 0, output: readFileSync(output, 'utf8') };
  } catch (error) {
    return { status: error.status, output: readFileSync(output, 'utf8') };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

const runPreflight = (helmFiles, environment) =>
  runStep(stepScript('preflight', 'Check Helm chart and environment variables'), helmFiles, environment).status;

test('preflight blocks the deploy while Helm values keep placeholders', () => {
  const chart = 'name: fe\n';
  assert.equal(runPreflight({ 'Chart.yaml': chart, 'values-dev.yaml': 'host: "<TO_BE_DEFINED_INGRESS_HOST>"\n' }), 1);
  assert.equal(runPreflight({ 'Chart.yaml': chart }), 1);
  assert.equal(runPreflight({ 'Chart.yaml': chart, 'values-dev.yaml': 'host: fe.example.com\n' }), 0);
});

test('image base href follows the HAProxy ingress path of the environment', () => {
  const script = stepScript('preflight', 'Base href from the HAProxy ingress path');
  const values = (path) => ({ 'values-dev.yaml': `microservice-chart:\n  ingress:\n    haproxy:\n      path: ${path}\n` });
  assert.equal(runStep(script, values('/nodo-observability/ui')).output, 'base_href=/nodo-observability/ui/\n');
  assert.equal(runStep(script, values('/ui/')).output, 'base_href=/ui/\n');
  assert.equal(runStep(script, values('"/ui(/|$)(.*)"')).status, 1);
  assert.match(job('image'), /BASE_HREF=\$\{\{ needs\.preflight\.outputs\.base_href \}\}/);
});

test('Helm namespace and workload identity match the GitHub environment Terraform', () => {
  const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const identity = read('.identity/00_data.tf');
  const variables = read('.identity/99_variables.tf');
  assert.match(read('.identity/03_github_environment.tf'), /"NAMESPACE" : local\.domain/);
  const domain = variables.match(/^\s*domain\s*=\s*"([^"]+)"/m)?.[1];
  assert.equal(domain, 'nodo');
  assert.match(
    identity,
    /"workload_identity_clientid" \{\s*name\s*=\s*"nodo-cron-workload-identity"/,
  );
  for (const environment of ['dev', 'uat', 'prod']) {
    const values = read(`helm/values-${environment}.yaml`);
    assert.match(values, new RegExp(`^  namespace: "${domain}"$`, 'm'));
    assert.match(values, /^ {4}workloadIdentityEnabled: false$/m);
  }
  const deploy = job('deploy_aks');
  assert.match(deploy, /namespace: \$\{\{ vars\.NAMESPACE \}\}/);
  assert.match(deploy, /workloadIdentityClientId=\$\{\{ vars\.WORKLOAD_IDENTITY_ID \}\}/);
});
