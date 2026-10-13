# FlareMail patches to bundled TinyMCE 7.9.1

The bundled core URI scanner uses a linear path capture and then splits the
filename at its final slash/dot. Its original extensionless-directory semantics,
capture fields, URL conversion options, protocols and relative paths are retained.
The user-info capture requires an explicit colon before a password; it avoids
ambiguous repeated scans when no `@` is present. This also keeps long authored
image URLs usable without imposing the approved anchor-only 8192-character cap
on image sources.

The table dialog tolerates cancellation of `mceInsertTable` by the application's
10000-cell guard. If insertion produced no table, the dialog exits without trying
to apply properties to a missing table.

The Chinese language bundle also translates the application's table-size warning.

Application policy is implemented in `src/components/tiny-editor/content-budgets.js`
and `apps/shared/content-budgets.mjs`; do not replace these vendor files on upgrade
without rerunning URI compatibility and real-editor content-budget validation.
