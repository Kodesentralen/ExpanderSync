# ExpanderSync
Tool for syncing SuperOffice Customizations between local drive and installation

Typical usage:

1. Save the contents of ExpanderSync.crmscript in your installation with includeId "ExpanderSync" and choose a secret key (e.g. "TimeIsAnIllusion")
2. Execute: node.exe ExpanderSync.js -e http://hostname/scripts/customer.fcgi?action=safeParse&includeId=ExpanderSync&key=TimeIsAnIllusion -m get -t e:\src\hostname\ -y ejscript,screen_definition,screen_chooser,extra_tables -v 1

The -m parameter specifies sync direction: "status", "sync", "get" or "put". For the ejscript table, we support two-way sync based on last_changed datetimes. So, you can edit a file locally, and another file inside SuperOffice, and then using "-m sync" should update correctly. For the other tables, only "get" is supported for now, as we don't have last_changed in the db.

## Fetcher layout

With `--layout fetcher`, ExpanderSync creates the same folder/file structure as [CRMScript Fetcher](https://github.com/ehs5/crmscript_fetcher) (Scripts, Triggers, Screens, ScreenChoosers, Scheduled tasks, Tables). In this mode `-e` must point to the `crmscript_fetcher` script (not ExpanderSync.crmscript), and only `-m get` is supported (default):

    node ExpanderSync.js --layout fetcher -e "https://online.superoffice.com/CustXXXXX/CS/scripts/customer.fcgi?action=safeParse&includeId=crmscript_fetcher&key=secret" -t ./Cust12345/ --cleanFolders

- `-y` selects what to fetch: `scripts,triggers,screens,screen_choosers,scheduled_tasks,extra_tables` (default all). The ExpanderSync names `ejscript`, `screen_definition` and `screen_chooser` are accepted as aliases.
- `--cleanFolders` deletes files and folders inside the fetched folders that no longer exist in SuperOffice (CRMScript Fetcher always does this). Files in the root folder are never touched.
- Files are only rewritten when their content has changed. `--ignore`, `--includeOnly` and `--scrambleSecrets` work as usual.
