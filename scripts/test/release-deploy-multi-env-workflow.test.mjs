import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const workflow = readFileSync(
  new URL('../../.github/workflows/release_deploy_multi_env.yml', import.meta.url),
  'utf8',
);
const job = (name) => {
  const block = workflow.match(
    new RegExp(`^  ${name}:\\s*\\n([\\s\\S]*?)(?=^  [\\w-]+:|^\\S|(?![\\s\\S]))`, 'm'),
  )?.[1];
  assert.ok(block, `job ${name} is present`);
  return block;
};
const field = (block, name) => {
  const match = block.match(
    new RegExp(`^    ${name}:([^\\n]*)(\\n(?: {6,}[^\\n]*\\n|\\s*\\n)*)`, 'm'),
  );
  assert.ok(match, `${name} field is present`);
  return `${match[1]} ${match[2]}`.replace(/^\s*[>|]-?\s*/, '').trim();
};
const needs = (block) => {
  const value = field(block, 'needs');
  return value.startsWith('[')
    ? value
        .slice(1, value.indexOf(']'))
        .split(',')
        .map((item) => item.trim())
    : value
        .split('\n')
        .map((item) => item.trim().replace(/^-\s*/, ''))
        .filter(Boolean);
};
const stepScript = (jobName, stepName) => {
  const lines = job(jobName).split('\n');
  const step = lines.findIndex((line) => line.trim() === `- name: ${stepName}`);
  assert.notEqual(step, -1, `${stepName} step is present`);
  const end = lines.findIndex((line, index) => index > step && /^ {6}- /.test(line));
  const stepLines = lines.slice(step, end === -1 ? undefined : end);
  const run = stepLines.findIndex((line) => line.trim() === 'run: |');
  assert.notEqual(run, -1, `${stepName} has a shell script`);
  const scriptLines = [];
  for (const line of stepLines.slice(run + 1)) {
    if (line.trim() && !/^ {10}/.test(line)) break;
    scriptLines.push(line.slice(10));
  }
  return scriptLines.join('\n');
};

const runStep = (script, files = {}, overrides = {}) => {
  const directory = mkdtempSync(join(process.cwd(), '.multi-env-preflight-'));
  const output = join(directory, 'github-output');
  try {
    mkdirSync(join(directory, 'helm'));
    writeFileSync(output, '');
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(directory, name), content);
    }
    try {
      execFileSync('bash', ['-e', '-c', script], {
        cwd: directory,
        stdio: 'pipe',
        env: {
          ...process.env,
          ENVIRONMENT: 'dev',
          NAMESPACE: 'nodo',
          CLUSTER_NAME: 'aks',
          CLUSTER_RESOURCE_GROUP: 'rg',
          API_BASE_URL: 'https://api.example.test',
          ENTRA_TENANT_ID: 'tenant-id',
          ENTRA_CLIENT_ID: 'client-id',
          GITHUB_OUTPUT: output,
          ...overrides,
        },
      });
      return { status: 0, output: readFileSync(output, 'utf8') };
    } catch (error) {
      assert.equal(typeof error.status, 'number', 'validation script ran');
      return { status: error.status, output: Buffer.from(error.stdout ?? '').toString('utf8') };
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

const validHelmFiles = {
  'helm/Chart.yaml': 'name: observability\n',
  'helm/values-dev.yaml': 'microservice-chart:\n  ingress:\n    haproxy:\n      path: /ui\n',
};
const runPreflight = (files, overrides) =>
  runStep(stepScript('preflight', 'Check Helm chart and environment variables'), files, overrides);

const select = ({ dev = false, uat = false, prod = false, legacy = '' } = {}) => {
  const script = stepScript('setup', 'Select environments');
  const directory = mkdtempSync(join(process.cwd(), '.multi-env-selection-'));
  const output = join(directory, `github-output-${randomUUID()}`);
  try {
    writeFileSync(output, '', { flag: 'wx' });
    try {
      execFileSync('bash', ['-e', '-c', script], {
        cwd: directory,
        stdio: 'pipe',
        env: {
          ...process.env,
          DEPLOY_DEV: String(dev),
          DEPLOY_UAT: String(uat),
          DEPLOY_PROD: String(prod),
          LEGACY_ENVIRONMENT: legacy,
          GITHUB_OUTPUT: output,
        },
      });
    } catch (error) {
      assert.equal(typeof error.status, 'number', 'selection script ran');
      return { status: error.status };
    }
    const line = readFileSync(output, 'utf8')
      .split('\n')
      .find((item) => item.startsWith('environments='));
    assert.ok(line, 'selection emits environments');
    return { status: 0, environments: JSON.parse(line.slice('environments='.length)) };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
};

// Evaluate the workflow's actual job conditions against representative needs results.
const evaluate = (condition, context) => {
  const expression = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, '');
  const tokens = expression.match(/'[^']*'|==|!=|&&|\|\||[!(),.]|\*|[A-Za-z_][\w-]*/g) ?? [];
  assert.equal(
    tokens.join(''),
    expression.replace(/\s+/g, ''),
    `unsupported condition: ${expression}`,
  );
  let index = 0;
  const parsePrimary = () => {
    const token = tokens[index++];
    if (token === '!') return !parsePrimary();
    if (token === '(') {
      const value = parseOr();
      assert.equal(tokens[index++], ')');
      return value;
    }
    if (token?.startsWith("'")) return token.slice(1, -1);
    if (token === 'true' || token === 'false') return token === 'true';
    assert.ok(token, 'condition operand is present');
    if (tokens[index] === '(') {
      index++;
      const args = [];
      while (tokens[index] !== ')') {
        args.push(parseOr());
        if (tokens[index] !== ',') break;
        index++;
      }
      assert.equal(tokens[index++], ')');
      const functions = {
        always: () => true,
        cancelled: () => context.cancelled,
        success: () => Object.values(context.needs).every((item) => item.result === 'success'),
        failure: () => Object.values(context.needs).some((item) => item.result === 'failure'),
        contains: (container, value) => container.includes(value),
        fromJSON: JSON.parse,
      };
      assert.ok(functions[token], `supported function ${token}`);
      return functions[token](...args);
    }
    let value = context[token];
    while (tokens[index] === '.') {
      index++;
      const property = tokens[index++];
      value =
        property === '*'
          ? Object.values(value)
          : Array.isArray(value)
            ? value.map((item) => item[property])
            : value?.[property];
    }
    return value ?? '';
  };
  const parseComparison = () => {
    let value = parsePrimary();
    while (tokens[index] === '==' || tokens[index] === '!=') {
      const operator = tokens[index++];
      const right = parsePrimary();
      value = operator === '==' ? value === right : value !== right;
    }
    return value;
  };
  const parseAnd = () => {
    let value = parseComparison();
    while (tokens[index] === '&&') {
      index++;
      const right = parseComparison();
      value = value && right;
    }
    return value;
  };
  const parseOr = () => {
    let value = parseAnd();
    while (tokens[index] === '||') {
      index++;
      const right = parseAnd();
      value = value || right;
    }
    return value;
  };
  const result = parseOr();
  assert.equal(index, tokens.length, `complete condition parsed: ${expression}`);
  return Boolean(result);
};

const context = (environments = ['dev', 'uat', 'prod'], mode = 'sequential') => ({
  inputs: { deploy_mode: mode },
  github: { event_name: 'workflow_dispatch' },
  cancelled: false,
  needs: {
    setup: {
      result: 'success',
      outputs: { semver: 'patch', environments: JSON.stringify(environments) },
    },
    preflight: { result: 'success' },
    release: { result: 'success' },
    image: { result: 'success' },
    deploy_dev: { result: 'success' },
    deploy_uat: { result: 'success' },
  },
});
const runs = (name, state) => {
  const block = job(name);
  const directNeeds = Object.fromEntries(
    needs(block).map((dependency) => [dependency, state.needs[dependency]]),
  );
  return evaluate(field(block, 'if'), { ...state, needs: directNeeds });
};
const assertNeeds = (name, expected) =>
  assert.deepEqual(new Set(needs(job(name))), new Set(expected));

test('condition evaluator handles result gates and selected predecessors', () => {
  const state = context(['uat']);
  state.needs.deploy_dev.result = 'skipped';
  const condition =
    "${{ always() && !cancelled() && needs.preflight.result == 'success' && (needs.deploy_dev.result == 'success' || (needs.deploy_dev.result == 'skipped' && !contains(fromJSON(needs.setup.outputs.environments), 'dev'))) }}";
  assert.equal(evaluate(condition, state), true);
  state.needs.setup.outputs.environments = '["dev","uat"]';
  assert.equal(evaluate(condition, state), false);
  state.needs.deploy_dev.result = 'failure';
  assert.equal(evaluate("${{ !contains(needs.*.result, 'failure') }}", state), false);
  state.cancelled = true;
  assert.equal(evaluate('${{ !cancelled() }}', state), false);
});

test('selection rejects empty manual input and invalid legacy environments', () => {
  assert.notEqual(select().status, 0);
  assert.notEqual(select({ legacy: 'invalid' }).status, 0);
});

test('selection accepts each checkbox and combinations in environment order', () => {
  for (const name of ['dev', 'uat', 'prod']) {
    assert.deepEqual(select({ [name]: true }), { status: 0, environments: [name] });
  }
  assert.deepEqual(select({ dev: true, prod: true }), { status: 0, environments: ['dev', 'prod'] });
  assert.deepEqual(select({ dev: true, uat: true, prod: true }), {
    status: 0,
    environments: ['dev', 'uat', 'prod'],
  });
});

test('legacy environment overrides checkboxes and maps each value including all', () => {
  for (const name of ['dev', 'uat', 'prod']) {
    assert.deepEqual(select({ legacy: name, dev: true, uat: true, prod: true }), {
      status: 0,
      environments: [name],
    });
  }
  assert.deepEqual(select({ legacy: 'all' }), { status: 0, environments: ['dev', 'uat', 'prod'] });
});

test('dispatch and reusable call retain the intended input contracts', () => {
  const dispatch = workflow.match(/^  workflow_dispatch:\n([\s\S]*?)(?=^  workflow_call:)/m)?.[1];
  const call = workflow.match(/^  workflow_call:\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(dispatch);
  assert.ok(call);
  const input = (block, name) => {
    const result = block.match(
      new RegExp(`^      ${name}:\\n([\\s\\S]*?)(?=^      [\\w-]+:|(?![\\s\\S]))`, 'm'),
    )?.[1];
    assert.ok(result, `input ${name} exists`);
    return result;
  };
  for (const name of ['deploy_dev', 'deploy_uat', 'deploy_prod', 'beta']) {
    assert.match(input(dispatch, name), /type: boolean/);
    assert.match(input(dispatch, name), /default: false/);
  }
  for (const [name, defaultValue, options] of [
    ['deploy_mode', 'parallel', ['parallel', 'sequential']],
    ['semver', 'patch', ['skip', 'promote', 'patch', 'new_release', 'breaking_change']],
  ]) {
    const value = input(dispatch, name);
    assert.match(value, /type: choice/);
    assert.match(value, new RegExp(`default: ${defaultValue}\\b`));
    assert.deepEqual(
      [...value.matchAll(/^          - (\w+)/gm)].map((match) => match[1]).sort(),
      options.sort(),
    );
  }
  assert.deepEqual([...call.matchAll(/^      ([\w-]+):/gm)].map((match) => match[1]).sort(), [
    'environment',
    'semver',
  ]);
  for (const name of ['environment', 'semver']) {
    assert.match(input(call, name), /required: true/);
    assert.match(input(call, name), /type: string/);
  }
});

test('setup and preflight expose and validate the selected environments', () => {
  const setup = job('setup');
  const outputs = field(setup, 'outputs');
  for (const name of ['semver', 'environments', 'package_version'])
    assert.match(outputs, new RegExp(`\\b${name}:`));
  assert.doesNotMatch(setup, /nodo5-semver-setup@/);
  for (const [variable, input] of Object.entries({
    DEPLOY_DEV: 'deploy_dev',
    DEPLOY_UAT: 'deploy_uat',
    DEPLOY_PROD: 'deploy_prod',
    LEGACY_ENVIRONMENT: 'environment',
  }))
    assert.match(
      setup,
      new RegExp(`${variable}:\\s*\\$\\{\\{\\s*inputs\\.${input}\\b[^\\n]*\\}\\}`),
    );
  const preflight = job('preflight');
  assertNeeds('preflight', ['setup']);
  assert.match(preflight, /fromJSON\(needs\.setup\.outputs\.environments\)/i);
  assert.match(field(preflight, 'environment'), /matrix\.\w+/);
  assert.match(preflight, /ENVIRONMENT:\s*\$\{\{\s*matrix\.\w+\s*\}\}/);
  assert.match(preflight, /helm\/Chart\.yaml/);
  assert.match(preflight, /helm\/values-\$\{ENVIRONMENT\}\.yaml/);
  for (const name of [
    'NAMESPACE',
    'CLUSTER_NAME',
    'CLUSTER_RESOURCE_GROUP',
    'API_BASE_URL',
    'ENTRA_TENANT_ID',
    'ENTRA_CLIENT_ID',
  ]) {
    assert.match(preflight, new RegExp(`\\b${name}\\b`));
  }
});

test('semver resolver is wired to selection, inputs, ref and setup output', () => {
  const setup = job('setup');
  assert.ok(setup.indexOf('id: selection') < setup.indexOf('id: semver_resolver'));
  assert.match(
    field(setup, 'outputs'),
    /semver:\s*\$\{\{\s*steps\.semver_resolver\.outputs\.semver\s*\}\}/,
  );
  for (const [variable, expression] of Object.entries({
    ENVIRONMENTS: 'steps.selection.outputs.environments',
    SEMVER: 'inputs.semver',
    REF_NAME: 'github.ref_name',
    REF_TYPE: 'github.ref_type',
  })) {
    assert.ok(
      setup.includes(`${variable}: \${{ ${expression} }}`),
      `${variable} passes ${expression}`,
    );
  }
});

const resolveSemver = (environments, semver, refName = 'feature', refType = 'branch') =>
  runStep(
    stepScript('setup', 'Resolve semver'),
    {},
    {
      ENVIRONMENTS: JSON.stringify(environments),
      SEMVER: semver,
      REF_NAME: refName,
      REF_TYPE: refType,
    },
  );

test('semver resolver follows dev-only policy for main and non-main branches and tags', () => {
  for (const [semver, main, other] of [
    ['patch', 'patch', 'buildNumber'],
    ['promote', 'skip', 'skip'],
    ['skip', 'skip', 'skip'],
    ['new_release', 'minor', 'buildNumber'],
    ['breaking_change', 'major', 'buildNumber'],
  ]) {
    for (const [refName, refType, expected] of [
      ['main', 'branch', main],
      ['feature', 'branch', other],
    ]) {
      assert.deepEqual(
        resolveSemver(['dev'], semver, refName, refType),
        {
          status: 0,
          output: `semver=${expected}\n`,
        },
        `${semver} on ${refType} ${refName}`,
      );
    }
  }
});

test('dev-only tag semver accepts only promote or skip and blocks release bump requests', () => {
  for (const [semver, expected] of [
    ['promote', 'skip'],
    ['skip', 'skip'],
    ['patch', null],
    ['new_release', null],
    ['breaking_change', null],
  ]) {
    const result = resolveSemver(['dev'], semver, 'v1.0.0', 'tag');
    if (expected === null) {
      assert.notEqual(result.status, 0, `${semver} must be rejected on a dev-only tag`);
    } else {
      assert.deepEqual(result, { status: 0, output: `semver=${expected}\n` }, `${semver} on tag`);
    }
  }
  assertNeeds('release', ['setup', 'preflight']);
  assert.doesNotMatch(field(job('release'), 'if'), /always\(\)/i);
});

test('uat/prod selections continue to resolve supported tag semver choices to skip', () => {
  for (const environments of [
    ['uat'],
    ['prod'],
    ['dev', 'uat'],
    ['dev', 'prod'],
    ['uat', 'prod'],
    ['dev', 'uat', 'prod'],
  ]) {
    for (const semver of ['patch', 'promote', 'skip']) {
      assert.deepEqual(
        resolveSemver(environments, semver, 'v1.0.0', 'tag'),
        {
          status: 0,
          output: 'semver=skip\n',
        },
        `${JSON.stringify(environments)} ${semver} on tag`,
      );
    }
  }
});

test('semver resolver enforces uat/prod policy for single, mixed and all selections', () => {
  for (const environments of [
    ['uat'],
    ['prod'],
    ['dev', 'uat'],
    ['dev', 'prod'],
    ['uat', 'prod'],
    ['dev', 'uat', 'prod'],
  ]) {
    for (const [semver, expected] of [
      ['patch', 'patch'],
      ['promote', 'skip'],
      ['skip', 'skip'],
    ]) {
      assert.deepEqual(resolveSemver(environments, semver), {
        status: 0,
        output: `semver=${expected}\n`,
      });
      assert.deepEqual(resolveSemver(environments, semver, 'v1.0.0', 'tag'), {
        status: 0,
        output: 'semver=skip\n',
      });
      assert.notEqual(resolveSemver(environments, semver, 'main').status, 0);
      assert.notEqual(resolveSemver(environments, semver, 'main', 'tag').status, 0);
    }
    for (const semver of ['new_release', 'breaking_change']) {
      for (const [refName, refType] of [
        ['feature', 'branch'],
        ['main', 'branch'],
        ['v1.0.0', 'tag'],
      ]) {
        assert.notEqual(resolveSemver(environments, semver, refName, refType).status, 0);
      }
    }
  }
});

test('semver resolver rejects unsupported and empty reusable-call values', () => {
  for (const environments of [['dev'], ['uat'], ['dev', 'prod']]) {
    for (const semver of ['', 'minor', 'major', 'buildNumber', 'PATCH', 'unknown']) {
      assert.notEqual(
        resolveSemver(environments, semver).status,
        0,
        `${JSON.stringify(environments)} ${semver}`,
      );
    }
  }
});

test('setup and preflight use event SHA and image uses release tag or event SHA', () => {
  for (const name of ['setup', 'preflight']) {
    const checkout = job(name).match(/- name: Checkout\n([\s\S]*?)(?=^      - |(?![\s\S]))/m)?.[1];
    assert.ok(checkout);
    assert.match(checkout, /ref:\s*\$\{\{\s*github\.sha\s*\}\}/);
  }
  const checkout = job('image').match(/- name: Checkout\n([\s\S]*?)(?=^      - |(?![\s\S]))/m)?.[1];
  assert.ok(checkout);
  assert.match(
    checkout,
    /ref:\s*\$\{\{\s*needs\.release\.result\s*==\s*'success'\s*&&\s*format\('refs\/tags\/\{0\}',\s*needs\.release\.outputs\.version\)\s*\|\|\s*github\.sha\s*\}\}/,
  );
});

test('preflight rejects a missing Helm chart or environment values file', () => {
  const script = stepScript('preflight', 'Check Helm chart and environment variables');
  const chartMissing = runPreflight({
    'helm/values-dev.yaml': validHelmFiles['helm/values-dev.yaml'],
  });
  assert.notEqual(chartMissing.status, 0);
  assert.match(chartMissing.output, /Missing helm\/Chart\.yaml/);

  const valuesMissing = runPreflight({ 'helm/Chart.yaml': validHelmFiles['helm/Chart.yaml'] });
  assert.notEqual(valuesMissing.status, 0);
  assert.match(valuesMissing.output, /Missing helm\/values-dev\.yaml/);

  assert.equal(runStep(script, validHelmFiles).status, 0);
});

test('preflight rejects unresolved Helm placeholders', () => {
  for (const [file, content] of [
    ['helm/Chart.yaml', 'name: "<TO_BE_DEFINED_CHART_NAME>"\n'],
    ['helm/values-dev.yaml', 'host: "<TO_BE_DEFINED_INGRESS_HOST>"\n'],
  ]) {
    const result = runPreflight({ ...validHelmFiles, [file]: content });
    assert.notEqual(result.status, 0, `${file} must reject unresolved placeholders`);
    assert.match(result.output, /Unresolved <TO_BE_DEFINED_/);
  }
});

for (const name of [
  'NAMESPACE',
  'CLUSTER_NAME',
  'CLUSTER_RESOURCE_GROUP',
  'API_BASE_URL',
  'ENTRA_TENANT_ID',
  'ENTRA_CLIENT_ID',
]) {
  test(`preflight rejects missing ${name}`, () => {
    const script = stepScript('preflight', 'Check Helm chart and environment variables');
    const result = runStep(script, validHelmFiles, { [name]: '' });
    assert.notEqual(result.status, 0, `${name} must be required`);
    assert.match(result.output, new RegExp(`Missing GitHub environment variable ${name}`));
  });
}

test('base href rejects invalid and empty ingress paths', () => {
  const script = stepScript('preflight', 'Base href from the HAProxy ingress path');
  for (const path of ['"/ui(/|$)(.*)"', '""']) {
    const result = runStep(script, {
      ...validHelmFiles,
      'helm/values-dev.yaml': `microservice-chart:\n  ingress:\n    haproxy:\n      path: ${path}\n`,
    });
    assert.notEqual(result.status, 0, `ingress path ${path} must be rejected`);
    assert.match(result.output, /Invalid microservice-chart\.ingress\.haproxy\.path/);
  }
});

test('base href normalizes a valid ingress path', () => {
  const script = stepScript('preflight', 'Base href from the HAProxy ingress path');
  const result = runStep(script, validHelmFiles);
  assert.equal(result.status, 0);
  assert.equal(result.output, 'base_href=/ui/\n');
});

test('release runs once after preflight and only for a non-skip normalized semver', () => {
  const release = job('release');
  assertNeeds('release', ['setup', 'preflight']);
  assert.doesNotMatch(release, /matrix:/);
  assert.match(field(release, 'outputs'), /version:.*steps\.release\.outputs\.version/);
  assert.match(release, /beta:.*inputs\.beta/);
  const state = context();
  assert.equal(runs('release', state), true);
  state.needs.setup.outputs.semver = 'skip';
  assert.equal(runs('release', state), false);
  assert.doesNotMatch(
    field(release, 'if'),
    /always\(\)/i,
    'implicit success gate blocks failed preflight',
  );
});

test('image matrix reads each environment ingress and provides environment-specific build arguments', () => {
  const image = job('image');
  assertNeeds('image', ['setup', 'preflight', 'release']);
  assert.match(image, /fromJSON\(needs\.setup\.outputs\.environments\)/i);
  assert.match(field(image, 'environment'), /matrix\.\w+/);
  assert.match(image, /ENVIRONMENT:\s*\$\{\{\s*matrix\.\w+\s*\}\}/);
  assert.match(image, /helm\/values-\$\{ENVIRONMENT\}\.yaml/);
  assert.match(image, /microservice-chart\.ingress\.haproxy\.path/);
  assert.match(image, /BASE_HREF=\$\{\{\s*steps\.[\w-]+\.outputs\.base_href\s*\}\}/);
  for (const [name, source] of Object.entries({
    API_BASE_URL: 'vars',
    ENTRA_TENANT_ID: 'secrets',
    ENTRA_CLIENT_ID: 'vars',
    ENTRA_SCOPES: 'vars',
  }))
    assert.match(image, new RegExp(`${name}=\\$\\{\\{\\s*${source}\\.${name}\\s*\\}\\}`));
  assert.match(
    image,
    /needs\.release\.outputs\.version\s*\|\|\s*needs\.setup\.outputs\.package_version/,
  );
  assert.match(
    image,
    /tag=\$\{VERSION\}-\$\{ENVIRONMENT\}/,
    'image version tag includes its environment',
  );
  assert.match(
    image,
    /latest-\$\{\{\s*matrix\.\w+\s*\}\}/,
    'latest image tag includes its environment',
  );
});

test('image requires successful prerequisites and permits skipped release only for skip', () => {
  const state = context();
  assert.match(field(job('image'), 'if'), /always\(\)/i);
  assert.equal(runs('image', state), true);
  for (const dependency of ['setup', 'preflight', 'release']) {
    state.needs[dependency].result = 'failure';
    assert.equal(runs('image', state), false, `${dependency} failure blocks image`);
    state.needs[dependency].result = 'success';
  }
  state.needs.release.result = 'skipped';
  assert.equal(runs('image', state), false);
  state.needs.setup.outputs.semver = 'skip';
  assert.equal(runs('image', state), true);
  state.needs.setup.outputs.semver = 'patch';
  for (const dependency of ['setup', 'preflight']) {
    state.needs[dependency].result = 'skipped';
    assert.equal(runs('image', state), false, `${dependency} skip blocks image`);
    state.needs[dependency].result = 'success';
  }
  state.needs.release.result = 'skipped';
  state.needs.setup.outputs.semver = 'skip';
  assert.equal(runs('image', state), true, 'only semver=skip permits skipped release');
  state.needs.setup.outputs.semver = 'patch';
  state.needs.release.result = 'success';
  for (const dependency of ['setup', 'preflight', 'release']) {
    state.needs[dependency].result = 'cancelled';
    assert.equal(runs('image', state), false, `${dependency} cancellation blocks image`);
    state.needs[dependency].result = 'success';
  }
  state.cancelled = true;
  assert.equal(runs('image', state), false);
});

test('deployment jobs declare environments, dependencies and mode', () => {
  const common = ['setup', 'preflight', 'release', 'image'];
  assertNeeds('deploy_parallel', common);
  const parallel = job('deploy_parallel');
  assert.match(parallel, /fromJSON\(needs\.setup\.outputs\.environments\)/i);
  assert.match(field(parallel, 'environment'), /matrix\.\w+/);
  for (const [name, extra] of [
    ['dev', []],
    ['uat', ['deploy_dev']],
    ['prod', ['deploy_dev', 'deploy_uat']],
  ]) {
    assertNeeds(`deploy_${name}`, [...common, ...extra]);
    assert.match(field(job(`deploy_${name}`), 'environment'), new RegExp(`\\b${name}\\b`));
    assert.equal(runs(`deploy_${name}`, context(['dev', 'uat', 'prod'], 'parallel')), false);
    assert.equal(runs(`deploy_${name}`, context()), true);
    assert.equal(runs(`deploy_${name}`, context([], 'sequential')), false);
  }
  assert.equal(runs('deploy_parallel', context(['dev'], 'parallel')), true);
  assert.equal(runs('deploy_parallel', context(['dev'], 'sequential')), false);
  const reusable = context(['dev'], '');
  reusable.github.event_name = 'workflow_call';
  assert.equal(runs('deploy_parallel', reusable), true);
});

test('parallel deployments do not cancel other matrix targets on failure', () => {
  assert.match(field(job('deploy_parallel'), 'strategy'), /^(?: {6})?fail-fast: *false *$/m);
});

test('all deployments block on failed prerequisites, inappropriate release skip and cancellation', () => {
  for (const name of ['deploy_parallel', 'deploy_dev', 'deploy_uat', 'deploy_prod']) {
    const state = context(
      ['dev', 'uat', 'prod'],
      name === 'deploy_parallel' ? 'parallel' : 'sequential',
    );
    assert.equal(runs(name, state), true);
    assert.match(field(job(name), 'if'), /always\(\)/i);
    for (const dependency of ['setup', 'preflight', 'release', 'image']) {
      state.needs[dependency].result = 'failure';
      assert.equal(runs(name, state), false, `${name} blocks ${dependency} failure`);
      state.needs[dependency].result = 'success';
    }
    for (const dependency of ['setup', 'preflight', 'image']) {
      state.needs[dependency].result = 'skipped';
      assert.equal(runs(name, state), false, `${name} blocks skipped ${dependency}`);
      state.needs[dependency].result = 'success';
    }
    state.needs.release.result = 'skipped';
    assert.equal(runs(name, state), false, `${name} rejects unexpected release skip`);
    state.needs.setup.outputs.semver = 'skip';
    assert.equal(runs(name, state), true, `${name} accepts intentional release skip`);
    state.needs.setup.outputs.semver = 'patch';
    state.needs.release.result = 'success';
    for (const dependency of ['setup', 'preflight', 'release', 'image']) {
      state.needs[dependency].result = 'cancelled';
      assert.equal(runs(name, state), false, `${name} blocks cancelled ${dependency}`);
      state.needs[dependency].result = 'success';
    }
    state.cancelled = true;
    assert.equal(runs(name, state), false, `${name} blocks cancellation`);
  }
});

test('sequential deployments allow skipped predecessors only when unselected', () => {
  for (const [name, predecessor] of [
    ['deploy_uat', 'dev'],
    ['deploy_prod', 'dev'],
    ['deploy_prod', 'uat'],
  ]) {
    const state = context();
    state.needs[`deploy_${predecessor}`].result = 'failure';
    assert.equal(runs(name, state), false, `${name} blocks failed ${predecessor}`);
    state.needs[`deploy_${predecessor}`].result = 'skipped';
    assert.equal(runs(name, state), false, `${name} blocks skipped selected ${predecessor}`);
    state.needs.setup.outputs.environments = JSON.stringify(
      ['dev', 'uat', 'prod'].filter((item) => item !== predecessor),
    );
    assert.equal(runs(name, state), true, `${name} allows skipped unselected ${predecessor}`);
    state.needs[`deploy_${predecessor}`].result = 'failure';
    assert.equal(runs(name, state), false, `${name} blocks failed unselected ${predecessor}`);
    state.needs[`deploy_${predecessor}`].result = 'cancelled';
    assert.equal(runs(name, state), false, `${name} blocks cancelled ${predecessor}`);
  }
});

test('deployments use a pinned AKS action and environment-specific configuration', () => {
  for (const name of ['deploy_parallel', 'deploy_dev', 'deploy_uat', 'deploy_prod']) {
    const deployment = job(name);
    const environment =
      name === 'deploy_parallel' ? '${{ matrix.environment }}' : name.slice('deploy_'.length);
    assert.equal(
      field(deployment, 'runs-on').replace(/['"]/g, ''),
      `[self-hosted-job, ${environment}]`,
    );
    assert.ok(
      deployment.includes(
        'uses: pagopa/github-actions-template/aks-deploy@5e788a4717069100914e66149997ecfd4c48b746',
      ),
    );
    for (const [input, value] of Object.entries({
      branch:
        "${{ needs.release.result == 'success' && format('refs/tags/{0}', needs.release.outputs.version) || github.sha }}",
      client_id: '${{ secrets.CD_CLIENT_ID }}',
      subscription_id: '${{ secrets.SUBSCRIPTION_ID }}',
      tenant_id: '${{ secrets.ENTRA_TENANT_ID }}',
      env: environment,
      namespace: '${{ vars.NAMESPACE }}',
      cluster_name: '${{ vars.CLUSTER_NAME }}',
      resource_group: '${{ vars.CLUSTER_RESOURCE_GROUP }}',
      app_name: '${{ env.APP_NAME }}',
      helm_upgrade_options: '${{ steps.helm_options.outputs.options }}',
    }))
      assert.ok(deployment.includes(`${input}: ${value}`), `${name} sets ${input}`);
    assert.ok(
      deployment.includes(
        'RELEASE_VERSION: ${{ needs.release.outputs.version || needs.setup.outputs.package_version }}',
      ),
    );
    assert.ok(deployment.includes(`ENVIRONMENT: ${environment}`));
    assert.ok(
      deployment.includes("BETA_RELEASE: ${{ inputs.beta && needs.release.result == 'success' }}"),
    );
    assert.match(deployment, /workloadIdentityClientId=\$\{\{\s*vars\.WORKLOAD_IDENTITY_ID\s*\}\}/);
  }
});

test('deployment Helm options target the environment image while preserving beta stable images', () => {
  for (const name of ['deploy_parallel', 'deploy_dev', 'deploy_uat', 'deploy_prod']) {
    const script = stepScript(name, 'Helm options');
    for (const environment of ['dev', 'uat', 'prod']) {
      for (const beta of ['true', 'false', '']) {
        const result = runStep(
          script,
          {},
          {
            RELEASE_VERSION: '1.2.3-beta.1',
            ENVIRONMENT: environment,
            BETA_RELEASE: beta,
          },
        );
        assert.equal(result.status, 0, `${name} prepares Helm options`);
        const tag = `1.2.3-beta.1-${environment}`;
        assert.ok(
          result.output.includes(`--set microservice-chart.canaryDelivery.image.tag=${tag}`),
        );
        if (beta === 'true') {
          assert.doesNotMatch(result.output, /--set microservice-chart\.image\.tag=/);
          assert.match(result.output, /--set microservice-chart\.canaryDelivery\.create=true/);
        } else {
          assert.ok(result.output.includes(`--set microservice-chart.image.tag=${tag}`));
          assert.doesNotMatch(result.output, /--set microservice-chart\.canaryDelivery\.create=/);
        }
      }
    }
  }
});
