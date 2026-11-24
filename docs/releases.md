# Releases

How a change gets from a merged pull request into the hosted app and the offline file, how pinned
dependencies are refreshed, and how to roll back.

[`.github/workflows/app.yml`](../.github/workflows/app.yml) does what this guide describes: it
checks every pull request, deploys the app from `main`, and attaches the offline file to a release.

The app is published in two forms:

- **The hosted app**, at <https://cipher-envelope.github.io/>, on GitHub Pages, rebuilt from `main`.
  It is the site of the `cipher-envelope` organization, which publishes no other site, so the app
  has an origin it does not share with any other page (see [`standards.md`](standards.md), the
  page's policy). A project site's address, `<owner>.github.io/<repository>`, would share its
  owner's site's origin, and so would an address under the owner's custom domain.
- **The offline file**, a single HTML file attached to a GitHub release, with its hash published
  beside it. A matching hash shows that a download is, byte for byte, the file attached to that
  release; it does not show that the release itself is genuine.

Nothing is published to npm.

## Merging publishes

| Change | What it takes to be live |
|---|---|
| Anything but `README.md`, `LICENSE` and `docs/`: the app's source, its tests, its dependencies, the workflow | For the hosted app, the merge: the push to `main` builds and deploys when every check passes. For the offline file, a release |
| Only `README.md`, `LICENSE` or files under `docs/` | Nothing to deploy. The app is unchanged |
| A Pages setting | A new deploy |

A failed build deploys nothing, and the previous app stays up. A merge alone changes no offline
file: a file already downloaded stays as it was.

## Before the merge

1. The pull request's checks are green. For a change they do not cover, say in the pull request
   which checks ran locally.
2. The pull request says what changes for a user: which methods, inputs or secrets, and whether the
   envelope changes.
3. For a change to a method or the envelope: for a method meant for real data, encrypting and then
   decrypting with the right secret still gives back the original input exactly, and every envelope
   in `test/golden/`, which stands for those of earlier releases, still opens to what its test
   expects.
4. For a change to the workflow: its permissions and pins still follow
   [`standards.md`](standards.md), "Workflow".

Preview the app locally with `npm run dev`, or build the offline file with `npm run build` and open
`dist/cipher-envelope.html` from a local web server. Opening it straight from disk is not checked
yet. The build also writes `dist/cipher-envelope.html.sha256`.

## After the merge

1. Watch the workflow run for the merge commit: `gh run list --workflow app.yml --branch main`.
2. When the deploy is green, open the hosted app and check the change. Allow a few minutes for
   caches.
3. Record the run on the issue the pull request fixed, if there is one. `Fixes #N` closes the
   issue at merge, which is before the deploy finishes: reopen it if the deploy fails or the check
   on the hosted app does.

If a deploy fails, re-run only its failed job, and only while its run is still the newest on
`main`: re-running an older run deploys its older page over a newer one, which rolls the app back.
Re-running all of a run's jobs uploads a second site, which the deploy refuses, and the uploaded
site expires after a day; after that, only a new run on `main`, from the next merge, deploys.

## Releasing the offline file

1. Publish a release for a tag on `main`. The workflow builds and checks the page, checks that
   the tag's commit is reachable from `main`, and attaches the page with the hash the build wrote.
   A file built on a local machine is never uploaded. That check guards against a release made by
   mistake from a branch that was never merged; someone who can publish releases can get past it.
2. Download the attached file and its hash file, and check them with `sha256sum -c
   cipher-envelope.html.sha256` (on macOS, `shasum -a 256 -c cipher-envelope.html.sha256`). Then
   open the file as under "Before the merge".

A release asset is never replaced in place: the hash already published would no longer match. A
corrected file is a new release.

The workflow attaches the files after the release is published, so releases must not be made
immutable: an immutable release accepts no files once it is published. If the run fails, or attaches
only one of the two files, the release stays published without them. Delete it. A release runs the
workflow and the code of its tag's commit, so if the cause is in either, fix it on `main` and
publish a new release from a new tag there; otherwise publish the release again.

## Repository settings

The workflow needs these settings, which live outside the repository:

- Pages builds from GitHub Actions, and the `github-pages` environment accepts deploys from `main`
  only.
- The "Protect main" rule requires the check by its job name, "Check and build the page"; the
  rule can name it once the check has run on a pull request. A renamed job no longer reports under
  that name, so no pull request can merge until the rule is updated.
- In the Actions settings, every action must be pinned to a full commit SHA, and only GitHub's own
  actions are allowed.
- Members of the organization must not be able to create Pages sites. Its owners still can, so
  keeping to "No other repository in the `cipher-envelope` organization publishes a GitHub Pages
  site" ([`standards.md`](standards.md)) is up to them.
- A first-time contributor's pull request runs the workflow only after a maintainer approves it.
- Releases are not immutable (see "Releasing the offline file").

Checked on 2026-11-24: all of these are set, and the `github-pages` environment accepts deploys from
`main` only. The check runs on pull requests and passes. The first deploy failed: the upload and the
deploy ran in one job, and the deploy looked for the upload before it was listed, so the upload now
runs a job earlier. Not checked yet: the first successful deploy, the first release's attached files
and their hash, and how GitHub handles a waiting run and a re-run of only the failed job.

## What is live now

Nothing is live until the first deploy and the first release. Then:

- The hosted app: the last successful deploy run on `main`. The tip of `main` can be ahead of it by
  documentation-only commits.
- The offline file: the latest release, and its published hash.

## Refreshing the pinned files

Dependencies, including any `@borrowdale/*` package the app uses, are pinned to exact versions
with a committed lockfile. Moving a pin changes what the app runs, in the hosted app and in the next
offline file.

1. Read the release notes of the new version.
2. Move the pin and the lockfile together, in one pull request.
3. Say in the pull request what moved, and check the app as for any other change.

### Actions

Actions in the workflow are pinned to a commit SHA. To move one, replace the SHA and the version
comment together, and read the action's release notes first: the deploy job can write to Pages,
and the release job to releases.

## Rolling back

Revert the pull request and merge the revert. The merge deploys the previous app like any other
change. A revert that is merged but whose run failed has rolled nothing back. Re-running an older
run also puts its page back, but leaves `main` as it is, so the next merge undoes it.

What a rollback does not undo:

- Pages already cached stay visible elsewhere for a while.
- An offline file already downloaded stays on the user's machine. A faulty offline file is
  superseded by a new release, not recalled.
- Envelopes saved with the rolled-back version exist on users' machines, unchanged, and may not
  open in the previous app. A change that added a method or an envelope version is therefore fixed
  forward, not reverted.
- A value that was published by mistake is public. If it was a credential, revoke it first, then
  fix the app.
