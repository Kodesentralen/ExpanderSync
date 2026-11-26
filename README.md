# ExpanderSync
Tool for syncing SuperOffice Customizations between local drive and installation

Typical usage:

1. Save the contents of ExpanderSync.crmscript in your installation with includeId "ExpanderSync" and choose a secret key (e.g. "TimeIsAnIllusion")
2. Execute: node.exe ExpanderSync.js -e http://hostname/scripts/customer.fcgi?action=safeParse&includeId=ExpanderSync&key=TimeIsAnIllusion -m get -t e:\src\hostname\ -y ejscript,screen_definition,screen_chooser,extra_tables -v 1

The -m parameter specifies sync direction: "status", "sync", "get" or "put". For the ejscript table, we support two-way sync based on last_changed datetimes. So, you can edit a file locally, and another file inside SuperOffice, and then using "-m sync" should update correctly. For the other tables, only "get" is supported for now, as we don't have last_changed in the db.

## Pushing a few changed files

Use `-f` (repeatable) to limit processing to the elements stored in the given files or folders. Paths can be relative to the current folder or to `-t`. Typically combined with a config file, where later parameters override the ones in the file:

    node ExpanderSync.js --configFile expanderSyncConfig.json -m put -f "ejscript/Folder/someScript.body.crmscript" -f ejscript/AnotherFolder

- Works with all methods (`status`, `sync`, `get`, `put`). `--cleanFolders` is ignored when `-f` is used.
- Only existing elements can be updated; a warning is printed for `-f` entries that did not match anything (check `-y`, `-p` and `-t`).
- Files matching `--scrambleSecrets` are never pushed, since that would overwrite the secrets in SuperOffice.
- `--noPut` still prevents anything from being sent.

## Pushing files in the Fetcher layout

`--layout fetcher -m put -f file|folder` pushes CRMScript Fetcher files back to SuperOffice. Here `-e` must point to the ExpanderSync script (crmscript_fetcher cannot save). The database id is taken from the `.json` files written by `get`:

    node ExpanderSync.js --layout fetcher -e "https://.../customer.fcgi?action=safeParse&includeId=ExpanderSync&key=secret" -m put --noPut -f "Cust12345/Scripts/Folder/MyScript.crmscript"

- Supports scripts, triggers, ScreenChoosers, screen scripts and screen buttons. A folder pushes all `.crmscript` files below it.
- Use `--noPut` to see what would be sent, and `-v 2` to see which table/id/field each file goes to.

## Fetcher layout

With `--layout fetcher`, ExpanderSync creates the same folder/file structure as [CRMScript Fetcher](https://github.com/ehs5/crmscript_fetcher) (Scripts, Triggers, Screens, ScreenChoosers, Scheduled tasks, Tables). In this mode `-e` must point to the `crmscript_fetcher` script (not ExpanderSync.crmscript), and only `-m get` is supported (default):

    node ExpanderSync.js --layout fetcher -e "https://online.superoffice.com/CustXXXXX/CS/scripts/customer.fcgi?action=safeParse&includeId=crmscript_fetcher&key=secret" -t ./Cust12345/ --cleanFolders

- `-y` selects what to fetch: `scripts,triggers,screens,screen_choosers,scheduled_tasks,extra_tables` (default all). The ExpanderSync names `ejscript`, `screen_definition` and `screen_chooser` are accepted as aliases.
- `--cleanFolders` deletes files and folders inside the fetched folders that no longer exist in SuperOffice (CRMScript Fetcher always does this). Files in the root folder are never touched.
- `--include-blocked-verbs` writes the `blocked_verbs` field (if the fetcher script returns it) to each script's `.json` file as a comma separated list of names, e.g. `0` becomes `BlockNone`, `6` becomes `BlockPOST,BlockPUT` and `-1` becomes `BlockAll`. Without it, the field is left out.
- Files are only rewritten when their content has changed. `--ignore`, `--includeOnly` and `--scrambleSecrets` work as usual.
