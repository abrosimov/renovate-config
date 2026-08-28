# renovate-config

Shared Renovate policy for the repositories under `abrosimov` and
`abrosimov-tech`. One place to change, every repository follows.

Renovate runs self-hosted, on a scheduled rootless container, once per GitHub
App installation. Its onboarding pull request proposes a `renovate.json` that
does nothing but reference this preset, so each repository keeps a visible
record that Renovate is enabled while the policy itself stays central:

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["github>abrosimov/renovate-config"]
}
```

`github>abrosimov/renovate-config` resolves to `default.json` in this
repository's root.

## The policy

- Pull requests are assigned to `abrosimov` and labelled `dependencies`, plus
  the update type (`major`, `minor`, `patch`, `digest`) and the datasource
  (`docker`, `github-actions`, and so on), so a queue can be triaged at a
  glance.
- Minor, patch, digest and pin updates merge themselves once their checks
  pass, and carry an `automerge` label saying so. A repository with no checks
  at all has nothing to wait for, so there such an update merges immediately.
- Major upgrades never merge automatically. They are held behind a Dependency
  Dashboard tick and labelled `needs-decision`, because a major is a
  compatibility decision rather than a refresh.

## Overriding it

A repository that needs something different keeps its own settings beside the
`extends` line; a repository-level value wins over the preset. `setup_lab` does
this: it adds custom managers for its digest-pinned container images and holds
its stateful backends behind an explicit upgrade decision.
