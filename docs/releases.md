# Releases

How a change gets from a merged pull request into the hosted app and the offline file, how pinned
dependencies are refreshed, and how to roll back.

There is no code and no workflow yet. This guide records the release model as decided; the
commands are added when the workflow lands.

The app is published in two forms:

- **The hosted app**, on GitHub Pages, rebuilt from `main`.
- **The offline file**, a single HTML file attached to a GitHub release, with its hash published
  beside it so a download can be checked before it is opened.

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
3. For a change to a method or the envelope: encrypting and then decrypting with the right secret
   still gives back the original input.
4. For a change to the workflow: its permissions and pins still follow
   [`standards.md`](standards.md), "Workflow".

The commands to preview the app locally are added with the first code.

## After the merge

1. Watch the workflow run for the merge commit.
2. When the deploy is green, open the hosted app and check the change. Allow a few minutes for
   caches.
3. Record the run on the issue the pull request fixed, if there is one. `Fixes #N` closes the
   issue at merge, which is before the deploy finishes: reopen it if the deploy fails or the check
   on the hosted app does.

## Releasing the offline file

1. Build the single HTML file from a commit on `main`.
2. Compute its hash, attach the file to a new release, and publish the hash with it.
3. Download the attached file, check it against the published hash, and open it offline.

A release asset is never replaced in place: the hash already published would no longer match. A
corrected file is a new release.

## What is live now

- The hosted app: the last successful deploy run on `main`. The tip of `main` can be ahead of it by
  documentation-only commits.
- The offline file: the latest release, and its published hash.

## Refreshing the pinned files

Dependencies, the `@borrowdale/*` packages included, are pinned to exact versions with a committed
lockfile. Moving a pin changes what the app runs, in the hosted app and in the next offline file.

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
- Envelopes saved with the rolled-back version exist on users' machines, unchanged.
- A value that was published by mistake is public. If it was a credential, revoke it first, then
  fix the app.
