/*
  Support for "--layout fetcher": fetches from the crmscript_fetcher endpoint (CRMScript Fetcher by Espen Steen,
  https://github.com/ehs5/crmscript_fetcher) and writes files/folders identical to what CRMScript Fetcher creates.
  The layout logic mirrors data_creator.py and data_creation/*.py in that project (fetcher script version 2).
*/
var fs = require("fs");
var path = require("path");

const SUPPORTED_SCRIPT_VERSION = 2;

// Groups supported by the fetcher script. Key is the name used with -y
const groups = {
	scripts: { option: "fetch_scripts", folder: "Scripts" },
	triggers: { option: "fetch_triggers", folder: "Triggers" },
	screens: { option: "fetch_screens", folder: "Screens" },
	screen_choosers: { option: "fetch_screen_choosers", folder: "ScreenChoosers" },
	scheduled_tasks: { option: "fetch_scheduled_tasks", folder: "Scheduled tasks" },
	extra_tables: { option: "fetch_extra_tables", folder: "Tables" },
};

// ExpanderSync element types that can be used with -y as well
const groupAliases = {
	ejscript: ["scripts"],
	screen_definition: ["screens"],
	screen_chooser: ["triggers", "screen_choosers"],
};

// Keys removed from schedule entries, since they would cause constant updates to Git
const removedScheduleKeys = [
	"asap",
	"next_execution",
	"last_execution",
	"execution_time",
	"lock_expire",
	"lock_pid",
	"lock_ttl",
	"error_message",
	"last_error",
	"retries",
	"retry_interval",
];

// Default tables with extra fields. Key is domain in extra_fields
const defaultTables = {
	1: "Contact",
	2: "Company",
	4: "Request",
	8: "Message",
	32: "User",
	64: "Category",
	128: "FAQ entry",
	256: "FAQ category",
};

// Parse comma separated list of group names (or ExpanderSync aliases). Returns null if all groups should be fetched
function parseGroups(list) {
	if (!list) return null;
	const result = [];
	for (const name of list.split(",").map((s) => s.trim())) {
		const names = groupAliases[name] || [name];
		for (const n of names) {
			if (!(n in groups))
				throw (
					"Unsupported element type for fetcher layout: " +
					name +
					". Supported: " +
					Object.keys(groups).join(",")
				);
			if (result.indexOf(n) < 0) result.push(n);
		}
	}
	return result;
}

// Replace characters that are not allowed in Windows folders/files. Same as safe_name() in CRMScript Fetcher
function safeName(text) {
	const replaceChars = [
		["/", "."],
		['"', "'"],
		["\\", ".."],
		[":", " - "],
		["*", "X"],
		["<", " Lt "],
		[">", " Gt "],
		["|", "I"],
		["?", ""],
	];
	text = String(text);
	for (const [from, to] of replaceChars) text = text.split(from).join(to);
	return text;
}

// Same formatting as json.dump(content, indent=4, ensure_ascii=False) in Python
function toJson(content) {
	return JSON.stringify(content, null, 4);
}

// Same as create_file() in CRMScript Fetcher, which normalizes newlines to \n
function toScript(body) {
	if (body === undefined || body === null) body = "";
	return String(body).replace(/\r\n/g, "\n");
}

// Python f-string of a value, used for screen scripts
function pyStr(value) {
	return value === undefined || value === null ? "None" : String(value);
}

function omit(obj, keys) {
	const result = {};
	for (const key in obj) if (keys.indexOf(key) < 0) result[key] = obj[key];
	return result;
}

/*
  Build list of folders and files from fetcher JSON. Returns { folders: [relPath], files: [{ path: relPath, content }] }
  in the same order as CRMScript Fetcher creates them (matters if two entries end up with the same filename).
*/
function buildLayout(data, groupsToFetch) {
	const folders = [];
	const files = [];
	const addFolder = (p) => folders.push(p);
	const addFile = (p, content) => files.push({ path: p, content: content });

	// Walk a hierarchy (script folders, screen folders, extra table folders) the same way CRMScript Fetcher does
	function walkHierarchy(dir, hierarchy, lookupParentId, createInFolder) {
		if (lookupParentId === -1) createInFolder(dir, -1);
		for (const folder of hierarchy.filter((f) => f.parent_id === lookupParentId)) {
			const folderPath = dir + "/" + safeName(folder.name);
			addFolder(folderPath);
			createInFolder(folderPath, folder.id);
			walkHierarchy(folderPath, hierarchy, folder.id, createInFolder);
		}
	}

	// Scripts and ScreenChoosers/Triggers: <name>.crmscript with body and <name>.json with the rest
	function addScriptAndJson(dir, name, entry) {
		addFile(dir + "/" + name + ".crmscript", toScript(entry.body));
		addFile(dir + "/" + name + ".json", toJson(omit(entry, ["body"])));
	}

	if (groupsToFetch.indexOf("scripts") >= 0) {
		const dir = groups.scripts.folder;
		const group = data.group_scripts;
		addFolder(dir);
		walkHierarchy(dir, group.script_folders, -1, (folderPath, folderId) => {
			for (const script of group.scripts.filter((s) => s.hierarchy_id === folderId))
				addScriptAndJson(folderPath, safeName(script.description), script);
		});
	}

	if (groupsToFetch.indexOf("triggers") >= 0) {
		const dir = groups.triggers.folder;
		addFolder(dir);
		for (const trigger of data.group_triggers.triggers) {
			const name = trigger.description || "Unnamed trigger (ID " + trigger.id + ")";
			addScriptAndJson(dir, safeName(name), trigger);
		}
	}

	if (groupsToFetch.indexOf("screens") >= 0) {
		const dir = groups.screens.folder;
		const group = data.group_screens;
		addFolder(dir);
		walkHierarchy(dir, group.screen_folders, -1, (folderPath, folderId) => {
			for (const screen of group.screen_definition.filter((s) => s.hierarchy_id === folderId)) {
				const screenPath = folderPath + "/" + safeName("(Screen) " + screen.name);
				addFolder(screenPath);

				addFile(screenPath + "/Creation script.crmscript", toScript(pyStr(screen.creation_script)));
				addFile(
					screenPath + "/Loading script (before setFromCgi).crmscript",
					toScript(pyStr(screen.load_script_body)),
				);
				addFile(
					screenPath + "/Loading script (after setFromCgi).crmscript",
					toScript(pyStr(screen.load_post_cgi_script_body)),
				);
				addFile(
					screenPath + "/Load script (run after everything else).crmscript",
					toScript(pyStr(screen.load_final_script_body)),
				);

				addFolder(screenPath + "/Buttons");
				for (const button of group.screen_definition_action.filter(
					(a) => a.screen_definition === screen.id,
				))
					addFile(
						screenPath + "/Buttons/" + safeName(button.button + ".crmscript"),
						toScript(button.ejscript_body),
					);

				addFile(
					screenPath + "/screen_definition.json",
					toJson(
						omit(screen, [
							"load_script_body",
							"load_post_cgi_script_body",
							"load_final_script_body",
							"creation_script",
						]),
					),
				);

				// Note: CRMScript Fetcher does not filter item_config on domain, so neither do we
				const elements = group.screen_definition_element
					.filter((e) => e.screen_definition === screen.id)
					.map((e) =>
						Object.assign({}, e, {
							item_config: group.item_config.filter((ic) => ic.item_id === e.id),
						}),
					);
				addFile(screenPath + "/screen_definition_element.json", toJson(elements));

				addFile(
					screenPath + "/screen_definition_hidden.json",
					toJson(group.screen_definition_hidden.filter((h) => h.screen_definition === screen.id)),
				);
				addFile(
					screenPath + "/screen_definition_language.json",
					toJson(group.screen_definition_language.filter((l) => l.screen_definition === screen.id)),
				);
			}
		});
	}

	if (groupsToFetch.indexOf("screen_choosers") >= 0) {
		const dir = groups.screen_choosers.folder;
		addFolder(dir);
		for (const sc of data.group_screen_choosers.screen_choosers) {
			const name = sc.description || "Unnamed ScreenChooser (ID " + sc.id + ")";
			addScriptAndJson(dir, safeName(name), sc);
		}
	}

	if (groupsToFetch.indexOf("scheduled_tasks") >= 0) {
		const dir = groups.scheduled_tasks.folder;
		const group = data.group_scheduled_tasks;
		addFolder(dir);
		const schedules = group.schedule.map((s) => omit(s, removedScheduleKeys));
		for (const task of group.scheduled_task) {
			const schedule = schedules.find((s) => s.id === task.schedule_id);
			if (!schedule) {
				// CRMScript Fetcher crashes on this. We skip the task instead
				console.log("\r\nWarning: no schedule found for scheduled task with id " + task.id + ", skipping");
				continue;
			}
			addFile(
				dir + "/" + safeName(schedule.name) + ".json",
				toJson(Object.assign({}, task, { schedule: schedule })),
			);
		}
	}

	if (groupsToFetch.indexOf("extra_tables") >= 0) {
		const dir = groups.extra_tables.folder;
		const group = data.group_extra_tables;
		addFolder(dir);
		walkHierarchy(dir, group.extra_table_folders, -1, (folderPath, folderId) => {
			for (const table of group.extra_tables.filter((t) => t.hierarchy_id === folderId))
				addFile(
					folderPath + "/" + safeName(table.name + ".json"),
					toJson({
						extra_table: table,
						extra_fields: group.extra_fields.filter((f) => f.extra_table === table.id),
					}),
				);
		});
		for (const domain in defaultTables)
			addFile(
				dir + "/" + defaultTables[domain] + ".json",
				toJson({ extra_fields: group.extra_fields.filter((f) => f.domain === Number(domain)) }),
			);
	}

	return { folders: folders, files: files };
}

/*
  Remove files and folders below root that were not part of this fetch. Entries that only differ in case from
  a known entry are renamed instead, since that would be the same file on a case insensitive file system.
*/
function cleanFolder(root, knownFiles, knownFolders, isIgnored, printOutput) {
	const lower = (obj) => {
		const map = {};
		for (const key in obj) map[key.toLowerCase()] = key;
		return map;
	};
	const knownFilesLower = lower(knownFiles);
	const knownFoldersLower = lower(knownFolders);

	const entries = fs.readdirSync(root, { withFileTypes: true });
	const entryNames = entries.map((e) => e.name);
	for (const entry of entries) {
		let name = root + "/" + entry.name;
		const known = entry.isDirectory() ? knownFolders : knownFiles;
		const knownLower = entry.isDirectory() ? knownFoldersLower : knownFilesLower;

		// Only rename if the correctly cased entry is not also present (i.e. case sensitive file system)
		if (!(name in known) && name.toLowerCase() in knownLower) {
			const correctBasename = path.basename(knownLower[name.toLowerCase()]);
			if (entryNames.indexOf(correctBasename) < 0) {
				printOutput(1, "Renaming: " + name + " -> " + correctBasename);
				fs.renameSync(name, root + "/" + correctBasename);
				name = root + "/" + correctBasename;
			}
		}

		if (entry.isDirectory()) {
			cleanFolder(name, knownFiles, knownFolders, isIgnored, printOutput);
			if (!(name in knownFolders) && !isIgnored(name) && fs.readdirSync(name).length === 0) {
				printOutput(1, "Deleting unknown folder: " + name);
				fs.rmdirSync(name);
			}
		} else if (!(name in knownFiles) && !isIgnored(name)) {
			printOutput(1, "Deleting unknown file: " + name);
			fs.unlinkSync(name);
		}
	}
}

/*
  Fetch from the crmscript_fetcher endpoint and write files. ctx contains:
  client, options (NTLM options), endpoint, targetPath, groupList (from -y, or null for all), cleanFolders,
  writeFile(filename, data) and isIgnored(filename) from ExpanderSync.js, knownFiles and printOutput
*/
async function run(ctx) {
	const groupsToFetch = parseGroups(ctx.groupList) || Object.keys(groups);

	let url = ctx.endpoint;
	for (const name in groups)
		url += "&" + groups[name].option + "=" + (groupsToFetch.indexOf(name) >= 0 ? "True" : "False");

	ctx.printOutput(1, "Fetching: " + groupsToFetch.join(","));
	ctx.printOutput(3, url);
	ctx.options.url = url;
	const response = await ctx.client({ method: "get", url: url });
	if (!response || response instanceof Error || response.data === undefined)
		throw "Could not get data from SuperOffice: " + (response && response.message ? response.message : response);

	let data = response.data;
	if (typeof data === "string") {
		try {
			data = JSON.parse(data);
		} catch (e) {
			throw "Invalid JSON returned from endpoint. Is -e pointing to the crmscript_fetcher script?\r\n" + data.substring(0, 500);
		}
	}

	const scriptVersion = data.script_version || 1;
	if (scriptVersion !== SUPPORTED_SCRIPT_VERSION)
		throw "Unsupported crmscript_fetcher script version: " + scriptVersion + ", expected " + SUPPORTED_SCRIPT_VERSION;

	const layout = buildLayout(data, groupsToFetch);

	const knownFolders = {};
	for (const folder of layout.folders) {
		const folderPath = ctx.targetPath + folder;
		knownFolders[folderPath] = true;
		if (!ctx.isIgnored(folderPath)) fs.mkdirSync(folderPath, { recursive: true });
	}

	let counter = 1;
	for (const file of layout.files) {
		if (ctx.verboseLevel >= 1)
			process.stdout.write("\r - files: " + counter++ + "/" + layout.files.length);
		ctx.writeFile(ctx.targetPath + file.path, file.content);
	}
	if (ctx.verboseLevel >= 1) process.stdout.write("...done\r\n");

	if (ctx.cleanFolders)
		for (const name of groupsToFetch)
			cleanFolder(
				ctx.targetPath + groups[name].folder,
				ctx.knownFiles,
				knownFolders,
				ctx.isIgnored,
				ctx.printOutput,
			);
}

exports.run = run;
exports.buildLayout = buildLayout;
exports.safeName = safeName;
