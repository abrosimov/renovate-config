import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const preset = JSON.parse(readFileSync(new URL('../default.json', import.meta.url), 'utf8'));
const decisionRules = preset.packageRules.filter(
  (rule) => rule.groupSlug === 'pre-1-0-minor',
);
const automergeRules = preset.packageRules.filter(
  (rule) => rule.matchCurrentVersion && rule.addLabels?.includes('automerge'),
);

assert.equal(decisionRules.length, 1, 'Expected one pre-1.0 minor decision rule');
assert.equal(automergeRules.length, 1, 'Expected one version-qualified automerge label rule');

const [decisionRule] = decisionRules;
const [automergeRule] = automergeRules;

function matchesCurrentVersion(pattern, version) {
  assert.equal(typeof pattern, 'string');
  const negated = pattern.startsWith('!');
  const expression = negated ? pattern.slice(1) : pattern;
  assert.match(expression, /^\/.*\/$/, 'Expected a slash-delimited regular expression');
  const matched = new RegExp(expression.slice(1, -1)).test(version);
  return negated ? !matched : matched;
}

test('pre-1.0 decision policy applies only to minors and keeps its separate group', () => {
  assert.deepEqual(decisionRule.matchUpdateTypes, ['minor']);
  assert.equal(decisionRule.automerge, false);
  assert.equal(decisionRule.groupName, 'pre-1.0 minor updates');
  assert.deepEqual(decisionRule.addLabels, ['needs-decision']);
});

test('version-qualified automerge label applies only to minors', () => {
  assert.deepEqual(automergeRule.matchUpdateTypes, ['minor']);
  assert.deepEqual(automergeRule.addLabels, ['automerge']);
  assert.equal(preset.automerge, true);
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

    test(`${currentVersion} minor ${preOne ? 'requires' : 'does not require'} a decision`, () => {
      assert.equal(matchesCurrentVersion(decisionRule.matchCurrentVersion, currentVersion), preOne);
    });

    test(`${currentVersion} minor ${preOne ? 'excludes' : 'receives'} the automerge label`, () => {
      assert.equal(matchesCurrentVersion(automergeRule.matchCurrentVersion, currentVersion), !preOne);
    });
  }
}
