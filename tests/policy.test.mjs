import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

// The rules are evaluated by Renovate's own matcher rather than a copy of it:
// negated globs, undefined fields and label accumulation are exactly where a
// hand-written approximation and the real engine disagree.
const renovateDir = process.env.RENOVATE_DIR;
assert.ok(renovateDir, 'RENOVATE_DIR must point at an installed renovate package');
const { applyPackageRules } = await import(
  pathToFileURL(join(renovateDir, 'dist/util/package-rules/index.js')).href
);

const preset = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));

async function resolve(upgrade) {
  const config = await applyPackageRules({ ...preset, ...upgrade }, 'update');
  const labels = config.addLabels ?? [];
  return {
    automerge: config.automerge,
    groupSlug: config.groupSlug,
    decision: labels.includes('needs-decision'),
    automergeLabel: labels.includes('automerge'),
    minimumReleaseAge: config.minimumReleaseAge,
  };
}

const gomod = (depName, currentValue, updateType) => ({
  manager: 'gomod',
  datasource: 'go',
  depType: 'require',
  depName,
  packageName: depName,
  currentValue,
  currentVersion: currentValue,
  updateType,
});
const npm = (depName, depType, currentVersion, updateType) => ({
  manager: 'npm',
  datasource: 'npm',
  depType,
  depName,
  packageName: depName,
  currentValue: `^${currentVersion}`,
  currentVersion,
  updateType,
});
const pep621 = (depName, depType, currentVersion, updateType) => ({
  manager: 'pep621',
  datasource: 'pypi',
  depType,
  depName,
  packageName: depName,
  currentValue: `>=${currentVersion}`,
  currentVersion,
  updateType,
});
const docker = (manager, depName, currentValue, currentVersion, updateType) => ({
  manager,
  datasource: 'docker',
  versioning: 'docker',
  depName,
  packageName: depName,
  currentValue,
  currentVersion,
  updateType,
});

const SILENT = { automerge: true, decision: false, automergeLabel: true };
const DECISION = { automerge: false, decision: true, automergeLabel: false };

const cases = [
  ['stable Go module minor', gomod('github.com/jackc/pgx/v5', 'v5.9.2', 'minor'), { ...SILENT, groupSlug: 'gomod' }],
  ['Go extended library minor, permanently 0.x', gomod('golang.org/x/net', 'v0.57.0', 'minor'), { ...SILENT, groupSlug: 'gomod' }],
  ['generated Google API stubs minor', gomod('google.golang.org/genproto/googleapis/rpc', 'v0.0.0-20260803160001-6ac0973c030d', 'minor'), { ...SILENT, groupSlug: 'gomod' }],
  ['pre-1.0 npm minor', npm('lucide-react', 'dependencies', '0.563.0', 'minor'), { ...DECISION, groupSlug: 'pre-1-0-minor' }],
  ['pre-1.0 Go minor with v prefix', gomod('github.com/nexus-rpc/sdk-go', 'v0.6.0', 'minor'), { ...DECISION, groupSlug: 'pre-1-0-minor' }],
  ['0.0.x patch', pep621('pipecat-ai', 'project.dependencies', '0.0.105', 'patch'), { ...DECISION, groupSlug: 'pre-1-0-minor' }],
  ['0.x patch above 0.1', pep621('ruff', 'dependency-groups', '0.16.2', 'patch'), { ...SILENT, groupSlug: 'python' }],
  ['OpenTelemetry instrumentation minor, versioned with its 1.x core', pep621('opentelemetry-instrumentation-grpc', 'project.dependencies', '0.50b0', 'minor'), { ...SILENT, groupSlug: 'python' }],
  ['stable Python patch', pep621('pydantic', 'project.dependencies', '2.10.1', 'patch'), { ...SILENT, groupSlug: 'python' }],
  ['stable npm minor', npm('react', 'dependencies', '19.2.0', 'minor'), { ...SILENT, groupSlug: 'javascript' }],

  ['Python runtime minor in a base image', docker('dockerfile', 'python', '3.13-slim', '3.13', 'minor'), { ...DECISION, groupSlug: 'python-runtime-minor' }],
  ['Python runtime minor in a toolchain file', { manager: 'mise', datasource: 'github-tags', depName: 'python', packageName: 'python/cpython', currentValue: '3.13', currentVersion: '3.13', updateType: 'minor' }, { ...DECISION, groupSlug: 'python-runtime-minor' }],
  ['Python runtime patch', docker('dockerfile', 'python', '3.13.1-slim', '3.13.1', 'patch'), { ...SILENT, groupSlug: 'python-runtime' }],
  ['Node runtime major in a base image', docker('dockerfile', 'node', '22-alpine', '22', 'major'), { ...DECISION, groupSlug: 'node-runtime' }],
  ['Node runtime major in a toolchain file', { manager: 'mise', datasource: 'node-version', depName: 'node', packageName: 'node', currentValue: '22', currentVersion: '22', updateType: 'major' }, { ...DECISION, groupSlug: 'node-runtime' }],
  ['Node runtime major in a setup action', { manager: 'github-actions', datasource: 'github-releases', depType: 'uses-with', depName: 'node', packageName: 'actions/node-versions', currentValue: '22', currentVersion: '22', updateType: 'major' }, { ...DECISION, groupSlug: 'node-runtime' }],
  ['Node runtime major in engines', npm('node', 'engines', '22.0.0', 'major'), { ...DECISION, groupSlug: 'node-runtime' }],
  ['Go runtime minor in go.mod', { manager: 'gomod', datasource: 'golang-version', depType: 'golang', depName: 'go', packageName: 'go', currentValue: '1.27.0', currentVersion: '1.27.0', updateType: 'minor' }, { ...SILENT, groupSlug: 'go-runtime' }],
  ['Go runtime minor in a base image', docker('dockerfile', 'golang', '1.27-alpine', '1.27', 'minor'), { ...SILENT, groupSlug: 'go-runtime' }],

  ['workflow action major', { manager: 'github-actions', datasource: 'github-tags', depType: 'action', depName: 'actions/checkout', packageName: 'actions/checkout', currentValue: 'v6', currentVersion: 'v6', updateType: 'major' }, { ...SILENT, minimumReleaseAge: '14 days' }],
  ['npm development dependency major', npm('vite', 'devDependencies', '7.3.1', 'major'), { ...SILENT, minimumReleaseAge: '14 days' }],
  ['Python development dependency major', pep621('mypy-protobuf', 'dependency-groups', '3.6.0', 'major'), { ...SILENT, minimumReleaseAge: '14 days' }],
  ['npm runtime dependency major', npm('react-router-dom', 'dependencies', '7.13.0', 'major'), { ...DECISION, minimumReleaseAge: '14 days' }],
  ['Python runtime dependency major', pep621('pydantic', 'project.dependencies', '2.10.1', 'major'), { ...DECISION, minimumReleaseAge: '14 days' }],
  ['Python optional dependency major', pep621('anthropic', 'project.optional-dependencies', '1.5.0', 'major'), { ...DECISION, minimumReleaseAge: '14 days' }],
  ['Go module major', gomod('github.com/jackc/pgx/v5', 'v5.9.2', 'major'), { ...DECISION, minimumReleaseAge: '14 days' }],
  ['stateful image major', docker('docker-compose', 'postgres', '17-alpine', '17', 'major'), { ...DECISION, minimumReleaseAge: '14 days' }],

  ['digest under a versioned tag', docker('docker-compose', 'postgres', '17-alpine', '17', 'digest'), { ...SILENT, groupSlug: 'digests', minimumReleaseAge: null }],
  ['digest under latest', docker('docker-compose', 'temporalio/auto-setup', 'latest', undefined, 'digest'), { ...DECISION, groupSlug: 'unversioned-tags', minimumReleaseAge: null }],
  ['digest under a variant-only tag', docker('dockerfile', 'nginx', 'alpine', undefined, 'digest'), { ...DECISION, groupSlug: 'unversioned-tags', minimumReleaseAge: null }],
  ['workflow action digest', { manager: 'github-actions', datasource: 'github-tags', depType: 'action', depName: 'actions/checkout', packageName: 'actions/checkout', currentValue: 'v6', currentVersion: 'v6', updateType: 'digest' }, { ...SILENT, groupSlug: 'digests' }],
  ['first digest pin of an unversioned tag', docker('docker-compose', 'temporalio/auto-setup', 'latest', undefined, 'pinDigest'), { ...SILENT, groupSlug: 'digests' }],
  ['lock file maintenance', { manager: 'pep621', updateType: 'lockFileMaintenance' }, SILENT],
];

for (const [name, upgrade, expected] of cases) {
  test(name, async () => {
    const actual = await resolve(upgrade);
    for (const [key, value] of Object.entries(expected)) {
      assert.deepEqual(actual[key], value, `${key}: expected ${JSON.stringify(value)}, got ${JSON.stringify(actual[key])}`);
    }
  });
}

test('no update is labelled both automerge and needs-decision', async () => {
  for (const [name, upgrade] of cases) {
    const { decision, automergeLabel } = await resolve(upgrade);
    assert.ok(!(decision && automergeLabel), name);
  }
});

test('the label agrees with the behaviour for every case', async () => {
  for (const [name, upgrade] of cases) {
    const { automerge, decision, automergeLabel } = await resolve(upgrade);
    assert.equal(automergeLabel, automerge, `${name}: automerge label`);
    assert.equal(decision, !automerge, `${name}: needs-decision label`);
  }
});

for (const [version, preOne] of [
  ['0.0.1', true],
  ['0.9.0', true],
  ['0.99.0', true],
  ['0.99.0-rc.1', true],
  ['1.0.0', false],
  ['1.9.0', false],
  ['10.0.0', false],
]) {
  for (const prefix of ['', 'v']) {
    const currentVersion = `${prefix}${version}`;
    test(`${currentVersion} minor ${preOne ? 'requires' : 'does not require'} a decision`, async () => {
      const actual = await resolve(gomod('example.com/module', currentVersion, 'minor'));
      assert.equal(actual.decision, preOne);
      assert.equal(actual.automerge, !preOne);
    });
  }
}

test('routine updates merge through a pull request, and only a failing one is assigned', () => {
  assert.equal(preset.automerge, true);
  assert.equal(preset.automergeType, 'pr');
  assert.equal(preset.platformAutomerge, true);
  assert.equal(preset.assignAutomerge, false);
  assert.ok(preset.assignees?.length, 'a failing pull request needs somebody to assign');
});

test('a decision opens a pull request rather than waiting for a dashboard tick', () => {
  for (const rule of preset.packageRules) {
    assert.notEqual(rule.dependencyDashboardApproval, true, rule.description ?? JSON.stringify(rule));
  }
});
