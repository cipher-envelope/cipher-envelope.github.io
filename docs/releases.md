# Releases

How a change gets from a merged pull request into the hosted app and the offline file, how pinned
dependencies are refreshed, and how to roll back.

There is no workflow yet. This guide records the release model as decided; the workflow's
commands are added when it lands.

The app is published in two forms:

- **The hosted app**, on GitHub Pages, rebuilt from `main`, on a custom domain of its own: a
  subdomain used for nothing else, so the app has an origin it does not share with any other page
  (see [`standards.md`](standards.md), the page's policy). A project site's default address shares
  `<owner>.github.io` with every other site of the account, and a project site under the account's
  own custom domain shares that domain.
- **The offline file**, a single HTML file attached to a GitHub release, with its hash published
  beside it. A matching hash shows that a download is, byte for byte, the file attached to that
  release; it does not show that the release itself is genuine.

Nothing is published to npm.

## Merging publishes

| Change | What it takes to be live |
|---|---|
| The app's source, its dependencies, the workflow | For the hosted app, the merge: the push to `main` builds and deploys when every check passes. For the offline file, a release |
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

1. Watch the workflow run for the merge commit.
2. When the deploy is green, open the hosted app and check the change. Allow a few minutes for
   caches.
3. Record the run on the issue the pull request fixed, if there is one. `Fixes #N` closes the
   issue at merge, which is before the deploy finishes: reopen it if the deploy fails or the check
   on the hosted app does.

## Releasing the offline file

1. The release workflow builds the single HTML file from a commit on `main`, computes its hash, and
   attaches both to a new release. A file built on a local machine is never uploaded.
2. Download the attached file and its hash file, and check them with `sha256sum -c
   cipher-envelope.html.sha256` (on macOS, `shasum -a 256 -c cipher-envelope.html.sha256`). Then
   open the file as under "Before the merge".

A release asset is never replaced in place: the hash already published would no longer match. A
corrected file is a new release.

## What is live now

Nothing is live yet. Once the workflows exist:

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
comment together, and read the action's release notes first: the deploy job can write to Pages.

## Rolling back

Revert the pull request and merge the revert. The merge deploys the previous app like any other
change. A revert that is merged but whose run failed has rolled nothing back.

What a rollback does not undo:

- Pages already cached stay visible elsewhere for a while.
- An offline file already downloaded stays on the user's machine. A faulty offline file is
  superseded by a new release, not recalled.
- Envelopes saved with the rolled-back version exist on users' machines, unchanged, and may not
  open in the previous app. A change that added a method or an envelope version is therefore fixed
  forward, not reverted.
- A value that was published by mistake is public. If it was a credential, revoke it first, then
  fix the app.
