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

## The base

The preset extends `config:best-practices` rather than `config:recommended`.
The two differ by a hardening layer that would otherwise have to be written and
maintained here by hand: digest pinning for container images and workflow
actions, weekly lock file maintenance, abandonment reporting, configuration
migration pull requests, and a three-day cooldown on npm. The equivalent
cooldowns for crates.io and PyPI are not part of it and are added alongside.

One component of that base is worth knowing about because it is visible:
`:pinDevDependencies` changes `rangeStrategy` to `pin` for development
dependencies, so a repository with a `package.json` sees a one-off wave of
pinning pull requests the first time it picks this preset up.

## The quarantine

Nothing is proposed until a release has survived seven days in the wild, and a
major waits fourteen. The point is that a bad release should be found by
somebody else's machine rather than by ours, and a major carries the breaking
change by definition, so it gets the far end of the window.

Three options carry this, and all three are needed:

- `minimumReleaseAge` sets the window. On its own it is advisory — Renovate
  opens the pull request immediately and merely marks an internal check as
  pending.
- `internalChecksFilter: "strict"` is what actually withholds the branch and
  the pull request until the window has passed. It matches the default, but is
  set explicitly because a self-hosted global configuration can override that
  default for every repository it manages.
- `minimumReleaseAgeBehaviour: "timestamp-required"` holds an update whose
  datasource returns no release timestamp, so the window cannot be bypassed by
  a datasource that simply does not say when a version shipped.

Digest and pin moves are exempt. They carry no release timestamp to age
against, so `timestamp-required` would otherwise hold them indefinitely, and
they are not upgrades in the first place.

Security fixes are exempt too, by Renovate's own design: a vulnerability fix
skips the quarantine, the schedule and every rate limit.

## The grouping

Non-major updates are grouped by ecosystem, one branch each: Go modules,
GitHub Actions, container images, Python packages, JavaScript packages, Rust
crates, Ansible collections, developer tooling. Digest and pin moves share a
further branch of their own.

One branch for the whole fleet was the earlier policy and it was too coarse: a
single failing check parked everything, and a revert could not name what broke.
Grouping by ecosystem also leaves the curated monorepo groupings from the base
configuration to decide `major`, which is the case where moving a monorepo's
packages together actually matters.

## Merging and triage

- Minor, patch, digest and pin updates merge themselves once their checks pass
  and the quarantine has elapsed, and carry an `automerge` label saying so.
  Merging goes through the platform's native auto-merge with a squash strategy,
  which requires "Allow auto-merge" to be enabled in the repository's settings.
- A repository with no checks at all has nothing to wait for, so there such an
  update merges as soon as the quarantine is over.
- A pre-1.0 package may break on a minor and semver permits it, so pre-1.0
  minors get a branch of their own and are labelled `needs-decision`. They have
  to leave the group rather than merely lose automerge, because a branch
  automerges only when every upgrade in it does.
- Major upgrades never merge automatically. They are held behind a Dependency
  Dashboard tick and labelled `needs-decision`, because a major is a
  compatibility decision rather than a refresh.
- Assignees are set only on the branches that ask for a decision. A pull
  request that merges itself needs no owner, and a notification for one is
  noise.

## Security

Two independent alert channels are enabled. `vulnerabilityAlerts` reads GitHub
Advisory data, which needs Dependency graph and Dependabot alerts turned on in
the repository's settings and `read` on Dependabot alerts granted to the App.
`osvVulnerabilityAlerts` queries the OSV database directly and needs neither —
it covers direct dependencies for the Go, npm, Python, Rust, Maven, NuGet,
Packagist, RubyGems, Hex and Hackage datasources, and notably not Docker.

A fix from either channel is deliberately ungrouped and unthrottled, so it
cannot sit behind an ecosystem branch waiting for something unrelated. The
dashboard lists outstanding advisories in full.

## Overriding it

A repository that needs something different keeps its own settings beside the
`extends` line; a repository-level value wins over the preset. `setup_lab` does
this: it adds custom managers for its digest-pinned container images and holds
its stateful backends behind an explicit upgrade decision.
