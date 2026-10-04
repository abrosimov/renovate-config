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
  "extends": ["github>abrosimov/renovate-config#v2.0.0"]
}
```

`github>abrosimov/renovate-config` resolves to `default.json` in this
repository's root, and the `#v2.0.0` suffix pins that resolution to a tag. See
`Versioning` below for why the suffix is not optional.

## Versioning

A repository extends a tag, never the bare branch. The bare form resolves to
whatever `master` holds at the moment Renovate runs, which means a change here
reaches every repository at once, unreviewed and unannounced, and a mistake
does the same.

`.github/workflows/release.yml` cuts the tags, and the merge is what triggers
it: a push to `master` that touches `default.json` derives the next version,
re-runs the validator against what is about to be tagged, rejects a version
that already exists, and creates the annotated tag and a release with
generated notes. Nothing is dispatched and nothing is decided by hand, because
a release that waits for somebody to remember it is a change that has not
shipped.

The version comes from the commit messages since the last tag. A subject
marked breaking, as `type!:` or with a `BREAKING CHANGE:` footer, takes the
major; a `feat:` takes the minor; anything else is a patch. Breaking here
means a change a consuming repository has to act on, and the distinction is
one that matters downstream rather than in this repository: a major is what
turns the adoption into a decision, an assigned pull request, everywhere this
preset is pinned.

Releases are immutable, which is the point of pinning: a tag that could be
moved would change the policy under every repository that already resolved it,
silently and without a pull request. The consequence is that a version cannot
be recut, so the workflow is written to be resumable rather than repeatable —
a rerun after a failure finishes the tag or the release that is missing
instead of colliding with itself, and a genuinely bad release is answered by
the next version rather than by deleting one.

The path filter is deliberate. Only `default.json` reaches the consumers, so a
change confined to the README or to a workflow releases nothing and raises no
pull requests across the fleet. Dispatch stays available with an explicit
version, for the case where the derived one is not the one that was meant.

Moving the pin afterwards is Renovate's own work rather than a chore. Its
`renovate-config` manager reads the `extends` list, recognises a preset that
names a tag and tracks it against this repository's tags, so a release raises
an ordinary pull request in every consumer, running that repository's checks
against the new policy before it applies. Those pull requests skip the
quarantine, because the change was already reviewed and validated here, and
they automerge on a minor or a patch like anything else.

That mechanism is also the reason the suffix is not optional: the manager
skips a preset with no version to compare against, so an unpinned repository
raises nothing and quietly tracks `master` instead.

The tag in the example above is simply the current release; a repository is
pinned to it once, by hand, and Renovate moves the pin from then on. A major
release of this preset arrives in a consumer the same way any other major
does, as an assigned pull request waiting for its merge button, which is what
a policy change that needs a repository setting to be flipped should look
like.

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

One component of it is overridden rather than inherited. `config:recommended`
pulls in `:ignoreModulesAndTests`, which sets `ignorePaths` to skip not only
the artefact directories but `test`, `tests`, `__tests__`, `__fixtures__` and
`examples` as well. That is a path filter on manifest discovery, not a filter
on dependency types, so it never touched a root `package.json`'s development
dependencies — what it hid was a manifest that lives inside one of those
directories: a `tests/requirements.txt`, an integration `test/go.mod`, a
`tests/docker-compose.yml` pinning the images a test suite starts. Those files
were not extracted at all, which means they raised no upgrades and, more to
the point, no advisories either, so the two alert channels below had a blind
spot exactly where a repository keeps the dependencies nobody reads.

`ignorePaths` is declared non-mergeable, so naming it here replaces the
preset's list outright rather than adding to it; a preset already in `extends`
cannot be withdrawn any other way. What remains is the three directories that
hold build artefacts rather than sources. `vendor` stays because Go's vendor
tree is generated — `gomodTidy` regenerates it from the `go.mod` that Renovate
does read. The cost is the one the preset was buying: `examples` and
`__fixtures__` raise pull requests again, and a fixture pinned deliberately to
an old version will be offered a newer one.

Lock files are refreshed rather than left to drift. `gomodTidy` keeps `go.mod`
honest, `gomodUpdateImportPaths` rewrites the `/vN` import paths a Go major
demands and restores the `go mod tidy` that Renovate otherwise skips on a
major, and the npm, pnpm and Yarn dedupe options collapse the duplicate trees
an upgrade leaves behind. Everything else that carries a lock file — uv, PDM,
Poetry, Cargo, Bundler, Composer and the rest — updates it through its own
manager with no option to set.

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

Language runtimes cut across the ecosystems and are grouped by name instead:
`go` and `golang`, `node`, `python`. A repository pins its runtime in several
places at once — the `go` directive and the `golang` image, a setup action's
input, `engines`, a version file, a toolchain manager — and grouping by name
moves all of them in one commit, so a build never mixes two versions of the
same runtime. A runtime major still gets a branch of its own, separate from
the runtime's minors and patches.

## Merging and triage

The policy sorts every update into one of three outcomes, and only the last
two put anything in front of a person.

1. **Routine: nothing to see.** Minor, patch, digest and pin updates, lock
   file maintenance, and the majors listed below as decided by the checks.
   Once the quarantine has elapsed Renovate opens a pull request, labelled
   `automerge` and unassigned, with the platform's native auto-merge enabled
   (`automergeType: "pr"`, `platformAutomerge: true`). The repository's checks
   and branch protection run on it as on any other pull request, and GitHub
   merges it once they pass. Nothing reaches the base branch without a pull
   request.
2. **Routine that failed: an assigned pull request.** When a check goes red,
   the pull request stays open and Renovate assigns it (`assignees` with
   `assignAutomerge: false`, which withholds assignees only while the checks
   are passing or pending). This is the one notification a routine update
   produces, and it means something broke.
3. **Decision: an assigned pull request, straight away.** A major, a pre-1.0
   update, a Python minor and a digest under an unversioned tag open a pull
   request at once, assigned and labelled `needs-decision`, with the checks
   already running. The decision is the merge button; there is no Dependency
   Dashboard tick to give first.

What counts as a decision:

- A major upgrade, because it is a compatibility decision rather than a
  refresh. Three classes are exempt, because for them the decision is one the
  checks can make: the development toolchain (workflow actions, pre-commit,
  mise, asdf, nix and the Rust toolchain), npm `devDependencies`, and Python
  development groups (`[dependency-groups]`, uv's and PDM's dev dependencies).
  All of them break the pipeline inside their own pull request. Base images are
  deliberately not exempt: a major there is a change of operating system,
  which passes the checks and surfaces in production instead. Nor are language
  runtimes, even where a toolchain manager or a setup action is what pins them.
  The fourteen-day quarantine applies to every major either way.
- A pre-1.0 minor, and a patch below 0.1, because semver gives them no
  compatibility promise. They get a branch of their own; they have to leave
  their ecosystem group rather than merely lose automerge, because a branch
  automerges only when every upgrade in it does. Packages that are permanently
  0.x and versioned like a 1.x are exempt: `golang.org/x`, the generated
  `google.golang.org/genproto` stubs, and the OpenTelemetry contrib and
  instrumentation packages that move in lockstep with their 1.x core.
- A Python minor, because Python versions its language on the minor: modules
  are removed, the ABI compiled wheels target changes, and packages drop
  support there.
- A digest under a tag that names no version — `latest`, `alpine`, `stable` —
  because the move is whatever upstream released since, majors and schema
  migrations included, and digests carry no release date to quarantine
  against. The durable answer is a versioned tag in the repository.

What a consuming repository has to provide:

- **Required checks on the base branch.** Native auto-merge waits for the
  checks that branch protection requires, not for every check that happens to
  run, so the checks that should gate an update have to be marked required,
  and they have to run on every pull request: a check behind a `paths` filter
  never reports on a pull request that misses those paths, and a required
  check that never reports blocks the merge for good. The name must match
  exactly, and a matrix job reports one check per leg, `lint (ubuntu-latest)`
  rather than `lint`. The Renovate App needs no bypass of the protection rule:
  it never pushes to the base branch.
- **A repository with no checks waits for a person.** Renovate reads a commit
  with no checks as pending rather than green (its own `renovate/` statuses do
  not count), so it never merges such a pull request itself. That holds for a
  repository without CI and for one whose CI does not run on every pull
  request; its routine updates still arrive as pull requests, and the merge
  button is the review.
- **Auto-merge and merge commits allowed.** "Allow auto-merge" and "Allow
  merge commits" must be enabled: Renovate asks the platform for the
  `merge-commit` strategy this preset names, and a repository with either
  switched off rejects the request and the pull request simply waits.

`rebaseWhen: "auto"` lets Renovate choose its rebase policy for each branch.
Without a merge queue, automerging branches and branches whose protection
requires them to be up to date use `behind-base-branch`. Other branches use
`conflicted`: a pre-1.0 minor or a major awaiting a decision is not continually
rebased unless the repository requires it.

Current Renovate versions detect GitHub Merge Queue and use `conflicted` for
its target branch, because the queue tests each proposed merge against the
latest base and the changes ahead of it. This depends on the runner supporting
queue detection; see Renovate's [rebase policy documentation](https://docs.renovatebot.com/configuration-options/#rebasewhen).
The preset does not enable a queue or configure branch protection. Consumers
using a queue must enable it in GitHub and run their required checks on
`merge_group` events. Without a queue, required checks and the requirement to
be up to date must be enforced in GitHub if they are to gate native auto-merge.

This setting does not trigger Renovate after a merge. A scheduled runner still
updates branches on its next run, so adopting `auto` alone does not remove the
wait between merges in repositories without a queue.

Rebasing is also what re-runs the update, not merely what moves the commit.
Renovate rebuilds the branch from the current base and repeats the artefact
step on it, so `gomodTidy` and `gomodUpdateImportPaths` run again and `go.mod`,
`go.sum` and the vendor tree come out tidy against the base branch as it is
now; the same holds for the npm, pnpm and Yarn dedupe options. What it does not
do is tidy a base branch that drifted on its own — the step runs on the
upgrade Renovate is applying, in a repository that carries a `go.mod` it
touched, and nowhere else.

Two limits are worth knowing. A branch somebody has pushed to is never
rebased, because the rebase would discard that commit; Renovate detects the
modification, leaves the branch alone and says so on the pull request. And a
rebase is a new commit, so it re-runs the checks: with the self-hosted runner
this happens once per scheduled run rather than once per push to `master`, and
the ecosystem grouping keeps the count to a branch per ecosystem, but a busy
base branch and a long queue of open updates do multiply into CI time.

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

## Its own checks

A mistake in `default.json` is not found in this repository. It is found by
every repository that extends it, as a configuration error on a dependency
dashboard, with updates parked until somebody reads it. `.github/workflows/validate.yml`
runs `renovate-config-validator --strict` to keep that local: it checks option
names, manager names and regular expressions, and resolves every preset named
in `extends`.

Both validation and release also run `node --test tests/*.test.mjs` against
an installed Renovate package. The tests feed representative updates — a Go
module minor, a pre-1.0 npm minor, a Python runtime minor in a base image, a
Node major in a setup action, a digest under `latest` and so on — through
Renovate's own `applyPackageRules`, and check which of the three outcomes each
one gets, its group, and that its labels agree with its behaviour. The real
matcher is used rather than a copy because negated globs, fields an update
does not have, and label accumulation are exactly where an approximation and
the engine disagree. The import reaches into Renovate's internals, so a
restructuring upstream fails the weekly run loudly rather than passing
silently.

It runs on pushes and pull requests, and also once a week on a schedule. The
weekly run is the one that earns its keep. The preset is static but Renovate is
not, so an option can be renamed or withdrawn on one of its majors and the
breakage arrives without a commit to trigger anything. For the same reason the
validator is deliberately unpinned: the check is only meaningful against the
version the self-hosted runner is about to use.

The repository also carries its own `renovate.json` pointing at its own preset,
so the policy is applied to the workflow it just acquired and is exercised
against live traffic rather than only asserted. It is the one place that
extends the branch rather than a tag, because a preset that pinned itself
would need a release to adopt its own release.

WARNING: `--strict` does not check option values. A misspelt strategy or
update type passes validation and is then ignored at runtime, so a value read
off the documentation is worth reading twice.

## Overriding it

A repository that needs something different keeps its own settings beside the
`extends` line; a repository-level value wins over the preset. `setup_lab` does
this: it adds custom managers for its digest-pinned container images and holds
its stateful backends behind an explicit upgrade decision.
