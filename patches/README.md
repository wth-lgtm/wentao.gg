# patches/

`patch-package` runs at `postinstall` and applies these to `node_modules`, in filename
order.

## Why the webgl-fluid patches are sequenced

Vercel restores the previous build's `node_modules` before it installs, so the file a
patch targets is not pristine: it already carries whatever patch shipped last. A patch
that was EDITED in place then neither applies (its context lines are gone) nor reverses
(it is not the patch that was applied), and `patch-package` exits 1 under CI. The preview
build died in 8 s on two commits for exactly this, while a pristine local `npm ci`
applied the same edited patch cleanly — the two disagreed only about what was already in
the file. patch-package 8 applies `pkg+version+001+name.patch`, `+002+…` in order and
treats an earlier one it finds already applied as done, which is the only shape that
survives a restored cache, a pristine install and a fully patched cache alike (all three
simulated; the result is byte-equal each time).

## The rule

Never edit a patch that has shipped. Add the next step as a new file:

    npm_config_allow_remote=all npx patch-package <pkg> --append <name>

`--append` diffs against the package WITH the earlier patches applied, so each file holds
only its own hunks. `allow-remote` is needed because patch-package installs the pristine
package by the lockfile's tarball URL, which npm 12 refuses by default.
