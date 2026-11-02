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
// Notes are rendered by Renovate's own template engine too, so a helper or a
// field it does not expose fails here rather than on a pull request.
const { compile } = await import(pathToFileURL(join(renovateDir, 'dist/util/template/index.js')).href);

const preset = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));

async function resolve(upgrade, appendedRules = []) {
  const config = await applyPackageRules(
    { ...preset, packageRules: [...preset.packageRules, ...appendedRules], ...upgrade },
    'update',
  );
  const labels = config.addLabels ?? [];
  const notes = config.prBodyNotes ?? [];
  return {
    automerge: config.automerge,
    groupName: config.groupName,
    groupSlug: config.groupSlug,
    decision: labels.includes('needs-decision'),
    automergeLabel: labels.includes('automerge'),
    minimumReleaseAge: config.minimumReleaseAge,
    notes,
    rendered: notes.map((note) => compile(note, { ...config, ...upgrade }).trim()),
    prLabels: [...new Set([...(config.labels ?? []), ...labels])].sort(),
  };
}

// The headline of each note identifies it; the wording around it may change.
const NOTE = {
  pre1: '**Needs a decision: pre-1.0 package.**',
  major: '**Needs a decision: major update.**',
  pythonMinor: '**Needs a decision: Python minor.**',
  unversioned: '**Needs a decision: unversioned image tag.**',
  automerge: '**Merges itself**',
  lockFile: '**Lock file maintenance**',
};
const noteKinds = (notes) =>
  Object.entries(NOTE)
    .filter(([, headline]) => notes.some((note) => note.includes(headline)))
    .map(([kind]) => kind);

// Both alert channels raise a security fix by appending one rule per advisory
// after the preset's own, carrying the advisory's notes and
// force: { ...vulnerabilityAlerts } (lib/workers/repository/init/vulnerability.ts,
// lib/workers/repository/process/vulnerabilities.ts). Force is spread over the
// merged result rather than merged into it (lib/config/utils.ts), so a forced
// value replaces the accumulated one rather than adding to it: this is where
// the block's labels and notes meet the package rules' own.
const ADVISORY = 'Advisory details written by Renovate';
const securityFix = (upgrade) =>
  resolve(upgrade, [
    {
      matchDatasources: [upgrade.datasource],
      matchPackageNames: [upgrade.packageName],
      isVulnerabilityAlert: true,
      prBodyNotes: [ADVISORY],
      force: { ...preset.vulnerabilityAlerts },
    },
  ]);

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

const presetPin = (depName, currentValue, updateType) => ({
  manager: 'renovate-config',
  datasource: 'github-tags',
  depName,
  packageName: depName,
  currentValue,
  currentVersion: currentValue,
  updateType,
});

// The shape the github-actions manager gives a runs-on label: the bare
// operating system as depName and its release as the version
// (renovate/dist/modules/manager/github-actions/extract.js, extractRunner).
const runner = (depName, currentValue) => ({
  manager: 'github-actions',
  datasource: 'github-runners',
  versioning: 'docker',
  depType: 'github-runner',
  depName,
  packageName: depName,
  currentValue,
  currentVersion: currentValue,
  updateType: 'major',
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
  ['Ubuntu runner major', runner('ubuntu', '24.04'), { ...DECISION, minimumReleaseAge: '14 days' }],
  ['Ubuntu arm runner major', runner('ubuntu', '24.04-arm'), { ...DECISION, minimumReleaseAge: '14 days' }],
  ['Windows runner major', runner('windows', '2022'), { ...DECISION, minimumReleaseAge: '14 days' }],
  ['macOS runner major', runner('macos', '15'), { ...DECISION, minimumReleaseAge: '14 days' }],
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
  ['this preset\'s own minor', presetPin('abrosimov/renovate-config', 'v3.0.0', 'minor'), { ...SILENT, groupSlug: 'renovate-config', minimumReleaseAge: null }],
  ['this preset\'s own major', presetPin('abrosimov/renovate-config', 'v1.0.0', 'major'), { ...DECISION, minimumReleaseAge: null }],
  ['third-party preset minor', presetPin('example/renovate-config', 'v3.0.0', 'minor'), { ...SILENT, minimumReleaseAge: '7 days' }],
  ['third-party preset major', presetPin('example/renovate-config', 'v1.0.0', 'major'), { ...DECISION, minimumReleaseAge: '14 days' }],
  ['lock file maintenance', { manager: 'pep621', updateType: 'lockFileMaintenance' }, { ...SILENT, minimumReleaseAge: null }],
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

for (const [name, upgrade, expected] of [
  ['pre-1.0 Go minor', { ...gomod('github.com/nexus-rpc/sdk-go', 'v0.6.0', 'minor'), versioning: 'semver' }, ['dependencies', 'gomod', 'needs-decision', 'security']],
  ['stable Python patch', { ...pep621('pydantic', 'project.dependencies', '2.10.1', 'patch'), versioning: 'pep440' }, ['automerge', 'dependencies', 'python', 'security']],
  ['npm runtime dependency major', { ...npm('react-router-dom', 'dependencies', '6.30.0', 'major'), versioning: 'npm' }, ['dependencies', 'needs-decision', 'security']],
]) {
  test(`security fix for a ${name} keeps the dependencies label and the package rules' labels`, async () => {
    assert.deepEqual((await securityFix(upgrade)).prLabels, expected);
  });
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

// prBodyNotes accumulates across matching rules like addLabels, so a note on
// the wrong rule lands on pull requests it does not describe.
test('every pull request explains itself, and only in the words of its own outcome', async () => {
  const decisionNotes = new Set(['pre1', 'major', 'pythonMinor', 'unversioned']);
  for (const [name, upgrade] of cases) {
    const { decision, automergeLabel, notes } = await resolve(upgrade);
    const kinds = noteKinds(notes);
    assert.equal(kinds.some((kind) => decisionNotes.has(kind)), decision, `${name}: decision note, got ${kinds}`);
    assert.equal(kinds.includes('automerge'), automergeLabel, `${name}: automerge note, got ${kinds}`);
    assert.equal(kinds.filter((kind) => decisionNotes.has(kind)).length <= 1, true, `${name}: one reason, got ${kinds}`);
  }
});

const noteCases = [
  ['pre-1.0 npm minor', npm('lucide-react', 'dependencies', '0.563.0', 'minor'), ['pre1']],
  ['0.0.x patch', pep621('pipecat-ai', 'project.dependencies', '0.0.105', 'patch'), ['pre1']],
  ['Go module major', gomod('github.com/jackc/pgx/v5', 'v5.9.2', 'major'), ['major']],
  ['Node runtime major in a toolchain file', { manager: 'mise', datasource: 'node-version', depName: 'node', packageName: 'node', currentValue: '22', currentVersion: '22', updateType: 'major' }, ['major']],
  ['workflow action major, which merges itself', { manager: 'github-actions', datasource: 'github-tags', depType: 'action', depName: 'actions/checkout', packageName: 'actions/checkout', currentValue: 'v6', currentVersion: 'v6', updateType: 'major' }, ['automerge']],
  ['npm development dependency major, which merges itself', npm('vite', 'devDependencies', '7.3.1', 'major'), ['automerge']],
  ['Python runtime minor in a base image', docker('dockerfile', 'python', '3.13-slim', '3.13', 'minor'), ['pythonMinor']],
  ['digest under latest', docker('docker-compose', 'temporalio/auto-setup', 'latest', undefined, 'digest'), ['unversioned']],
  ['digest under a versioned tag', docker('docker-compose', 'postgres', '17-alpine', '17', 'digest'), ['automerge']],
  ['stable Python patch', pep621('pydantic', 'project.dependencies', '2.10.1', 'patch'), ['automerge']],
  ['stable Go module minor', gomod('github.com/jackc/pgx/v5', 'v5.9.2', 'minor'), ['automerge']],
  ['this preset\'s own major', presetPin('abrosimov/renovate-config', 'v1.0.0', 'major'), ['major']],
  ['lock file maintenance', { manager: 'pep621', updateType: 'lockFileMaintenance' }, ['automerge', 'lockFile']],
];

for (const [name, upgrade, expected] of noteCases) {
  test(`${name} carries the ${expected.join(' and ')} note`, async () => {
    const { notes } = await resolve(upgrade);
    assert.deepEqual(noteKinds(notes).sort(), [...expected].sort());
  });
}

test('every note is a GitHub alert block', async () => {
  for (const [name, upgrade] of noteCases) {
    for (const note of (await resolve(upgrade)).notes) {
      assert.match(note, /^> \[!(NOTE|IMPORTANT|CAUTION)\]\n> \*\*/, name);
    }
  }
});

test('a held major says how long it was held and how old the release is', async () => {
  const { rendered } = await resolve({
    ...gomod('github.com/jackc/pgx/v5', 'v5.9.2', 'major'),
    newVersion: 'v6.0.0',
    newVersionAgeInDays: 15,
  });
  assert.equal(rendered.length, 1);
  assert.match(rendered[0], /It was held for 14 days; github\.com\/jackc\/pgx\/v5 v6\.0\.0 is 15 days old\./);
  assert.doesNotMatch(rendered[0], /\{\{/);
});

test('a major that was not held does not claim to have been', async () => {
  const { rendered } = await resolve({ ...presetPin('abrosimov/renovate-config', 'v1.0.0', 'major'), newVersion: 'v2.0.0', newVersionAgeInDays: 0 });
  assert.equal(rendered.length, 1);
  assert.doesNotMatch(rendered[0], /held/);
  assert.match(rendered[0], /not merged automatically\. Read the release notes, then merge or close\.$/);
  const thirdParty = await resolve({ ...presetPin('example/renovate-config', 'v1.0.0', 'major'), newVersion: 'v2.0.0', newVersionAgeInDays: 20 });
  assert.match(thirdParty.rendered[0], /held for 14 days/);
});

test('the unversioned tag note names the tag', async () => {
  const { rendered } = await resolve(docker('docker-compose', 'temporalio/auto-setup', 'latest', undefined, 'digest'));
  assert.match(rendered[0], /The digest behind `latest` moved\./);
});

test('pre-1.0 updates share a branch named for what they are', async () => {
  for (const upgrade of [
    npm('lucide-react', 'dependencies', '0.563.0', 'minor'),
    pep621('pipecat-ai', 'project.dependencies', '0.0.105', 'patch'),
  ]) {
    const { groupName, groupSlug } = await resolve(upgrade);
    assert.equal(groupName, 'pre-1.0 packages');
    assert.equal(groupSlug, 'pre-1-0-minor', 'the slug names the branch, so it must not move');
  }
});

const CAUTION = /\n\n> \[!CAUTION\]\n> \*\*Security fix\.\*\* [^\n]*merge promptly\.$/;

test('vulnerabilityAlerts sets no notes, because its values are forced over every rule', () => {
  assert.equal(preset.vulnerabilityAlerts.prBodyNotes, undefined);
});

test('a pre-1.0 security fix keeps its reason, the advisory and a caution', async () => {
  const { rendered, notes } = await securityFix({ ...gomod('github.com/nexus-rpc/sdk-go', 'v0.6.0', 'minor'), newVersion: 'v0.7.0' });
  assert.deepEqual(noteKinds(notes), ['pre1']);
  assert.ok(rendered.includes(ADVISORY));
  const reason = rendered.find((note) => note.includes(NOTE.pre1));
  assert.match(reason, CAUTION);
});

test('a major security fix keeps its reason without claiming a hold', async () => {
  const { rendered, notes, minimumReleaseAge } = await securityFix({
    ...gomod('github.com/jackc/pgx/v5', 'v5.9.2', 'major'),
    newVersion: 'v6.0.0',
    newVersionAgeInDays: 1,
  });
  assert.equal(minimumReleaseAge, null, 'the caution is only true while security fixes skip the quarantine');
  assert.deepEqual(noteKinds(notes), ['major']);
  assert.ok(rendered.includes(ADVISORY));
  const reason = rendered.find((note) => note.includes(NOTE.major));
  assert.doesNotMatch(reason, /held/);
  assert.match(reason, CAUTION);
});

test('a security fix that merges itself says so and asks for nothing', async () => {
  const { rendered, notes } = await securityFix({ ...pep621('pydantic', 'project.dependencies', '2.10.1', 'patch'), newVersion: '2.10.2' });
  assert.deepEqual(noteKinds(notes), ['automerge']);
  assert.ok(rendered.includes(ADVISORY));
  assert.ok(rendered.every((note) => !note.includes('[!CAUTION]')));
});

test('an ordinary decision carries no security caution', async () => {
  const { rendered } = await resolve(gomod('github.com/jackc/pgx/v5', 'v5.9.2', 'major'));
  assert.ok(rendered.every((note) => !note.includes('[!CAUTION]')));
});

test('titles carry a semantic prefix in every repository', () => {
  assert.equal(preset.semanticCommits, 'enabled');
});

test('the dashboard header explains the sections and imitates none of its controls', () => {
  const header = preset.dependencyDashboardHeader;
  assert.ok(header, 'dependencyDashboardHeader must be set');
  for (const section of ['Pending Status Checks', 'Open']) {
    assert.ok(header.includes(`**${section}**`), section);
  }
  assert.doesNotMatch(header, /<!--|- \[[ x]\]/, 'Renovate parses its own markers and checkboxes out of the issue body');
});
