const axios = require("axios");
var fs = require("fs");
var path = require("path");
const { cpuUsage } = require("process");
const elementTypes = require("./elementTypes.js");
const https = require('https');
const ntlm = require('./ntlm');
const httpsAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

const client = axios.create({
  httpsAgent,
  agent: httpsAgent,
  withCredentials: true,
  shouldKeepAlive: true,
  keepAlive: true,
  keepAliveMsecs: 3000,
  maxRedirects: 0,
  'Access-Control-Allow-Origin': '*',
});

var options = {
  url: '',
  username: 'xxxx',
  password: 'zzzz',
  workstation: '',
  domain: ''
};

client.interceptors.response.use(
  (response) => {
    printOutput(3, 'NTLM: Response:', response);
    return response;
  },
  (err) => {
    printOutput(3, 'NTLM: Response error:', err);
    const error = err.response;
    if (error && error.status === 401 && error.headers['www-authenticate'] && error.headers['www-authenticate'] === 'Negotiate, NTLM' && !err.config.headers['X-retry']) {
      printOutput(3, "NTLM: sendType1Message");
      // TYPE 1 MESSAGE
      return sendType1Message();
    } else if (error && error.status === 401 && error.headers['www-authenticate'] && error.headers['www-authenticate'].substring(0, 4) === 'NTLM') {
      // TYPE 2 MESSAGE PARSE ANS TYPE 3 MESSAGE SEND
      printOutput(3, "sendType3Message");
      return sendType3Message(error.headers['www-authenticate']);
    }
    return err;
  },
);

client.interceptors.request.use((request) => {
  printOutput(3, 'NTLM: Starting Request', request);
  return request;
});

const sendType1Message = () => {
  var type1msg = ntlm.createType1Message(options);
  return client({
    method: 'get',
    url: options.url,
    headers: {
      'Connection': 'keep-alive',
      'Authorization': type1msg
    },
  });
};

const sendType3Message = token => {
  var type2msg = ntlm.parseType2Message(token, (err) => { console.log(err) });
  var type3msg = ntlm.createType3Message(type2msg, options);
  return client({
    method: 'get',
    url: options.url,
    headers: {
      'X-retry': 'false',
      'Connection': 'Close',
      'Authorization': type3msg
    },
  })
}

let endpoint = "";
let targetPath = "./";
let readOnly = false;
let debug = false;
let verboseLevel = 1;
let cleanFolders = false;
let noPut = false;
let ignoreJSONFiles = false;
const filenamesMap = {}; // Map of filenames so that children can lookup parents
let memoryFile = {}; // Map of files that are built in memory since they have multiple writes. Payload is { data: obj/string, mtime, indent }
const knownFiles = {}; // Map of created files. Used to know what files we have created. 

// Summary of sync
const syncSentFiles = [];
const syncReceivedFiles = [];

// Information about how tables and fields should be stored in the filesystem
const dbToDisk = {
  extra_menus: {
    fields: "id,screen,label,url,target,icon_url,extra_info,order_pos,flags,base_program,extra_table,group_id",
  },
  ejscript: {
    cleanFolder: "ejscript",
    fields: "id,description,include_id,hierarchy_id.fullname,registered,updated,body",
    json: "id:Integer,name:String,include_id:String,folder:String,registered:String,updated:String,body:String",
    jsonFile: true,
    updateFields: ["id"],
    scriptFiles: ["body"],
    hasRegisteredUpdated: true,
    folderField: "hierarchy_id.fullname",
    filename: "ejscript/${folder}/${name}/${name}",
  },
  screen_definition: {
    cleanFolder: "screen_definition",
    fields:
      "id,name,id_string,hierarchy_id.fullname,screen_key,load_script_body,load_post_cgi_script_body,load_final_script_body,creation_script,warn_on_navigate,description,autosave",
    json:
      "id:Integer,name:String,id_string:String,folder:String,screen_key:String,load_script_body:String,load_post_cgi_script_body:String,load_final_script_body:String,creation_script:String,warn_on_navigate:Boolean,description:String,autosave:Boolean",
    updateFields: ["id", "name", "screen_key"],
    jsonFile: true,
    scriptFiles: ["load_script_body", "load_post_cgi_script_body", "load_final_script_body", "creation_script"],
    folderField: "hierarchy_id.fullname",
    filename: "screen_definition/${folder}/${name}/${name}",

    children: {
      screen_definition_element: {
        fields:
          "id,name,screen_definition.name,screen_definition.hierarchy_id.fullname,element_type,description,creation_script,order_pos,base_table,hide",
        json:
          "id:Integer,name:String,screen_definition:String,folder:String,element_type:Integer,description:String,creation_script:String,order_pos:integer,base_table:String,hide:Boolean",
        jsonFile: true,
        scriptFiles: ["creation_script"],
        folderField: "screen_definition.hierarchy_id.fullname",
        filename: "screen_definition/${folder}/${screen_definition}/screen_definition_element/${id}-${name}",
        order: "screen_definition_element.order_pos",
        where: [{ field: "screen_definition.id", operator: "gt", vaue: "0" }],
        children: {
          item_config: {
            fields: "id,domain,item_id,item_name,item_value",
            json: "id:Integer,domain:Integer,item_id:Integer,item_name:String,item_value:String",
            jsonFile: true,
            filenameLookup: "screen_definition_element:${item_id}",
            appendToJson: "config",
            where: [{ field: "domain", operator: "equals", value: "1" }],
          },
        },
      },
      screen_definition_action: {
        fields: "id,button,ejscript_body,screen_definition.name,screen_definition.hierarchy_id.fullname",
        json: "id:Integer,button:String,ejscript_body:String,screen_definition:String,folder:String",
        scriptFiles: ["ejscript_body"],
        folderField: "screen_definition.hierarchy_id.fullname",
        filename: "screen_definition/${folder}/${screen_definition}/screen_definition_action/${button}",
      },
      screen_definition_hidden: {
        fields: "id,variable,screen_definition,",
        json: "id:Integer,variable:String,screen_definition:String",
        jsonFile: true,
        filenameLookup: "screen_definition:${screen_definition}",
        appendToJson: "hidden",
      },
      /*
      screen_definition_language: {
        fields: "id,language,variable_name,variable_value,screen_definition.name,screen_definition.hierarchy_id.fullname",
        json: "id:Integer,language:String,variable_name:String,variable_value:String,screen_definition:String,folder:String",
        jsonFile: true,
        filenameLookup: "screen_definition:${screen_definition}",
        appendToJson: "language",
      },
      */
    },
  },
  screen_chooser: {
    cleanFolder: "screen_chooser",
    fields: "id,description,ejscript,registered,updated",
    json: "id:Integer,description:String,ejscript:String,registered:String,updated:String",
    updateFields: ["id", "ejscript"],
    hasRegisteredUpdated: true,
    scriptFiles: ["ejscript"],
    filename: "screen_chooser/${id}-${description}",
  },
  extra_tables: {
    cleanFolder: "extra_tables",
    fields:
      "id,table_name,name,search_header,view_entry_header,new_entry_header,edit_entry_header,hierarchy_id.fullname,display_field.field_name,description",
    json:
      "id:Integer,table_name:String,name:String,search_header:String,view_entry_header:String,new_entry_header:String,edit_entry_header:String,folder:String,display_field:String,description:String",
    jsonFile: true,
    filename: "extra_tables/${folder}/${table_name}",
    children: {
      extra_fields: {
        fields: "id,domain,extra_table,target_extra_table.table_name,field_name,name,default_value,type,flags,params,description",
        json:
          "id:Integer,domain:Integer,extra_table:Integer,target_extra_table:String,field_name:String,name:String,default_value:String,type:Integer,flags:Integer,params:String,description:String",
        filenameLookup: "extra_tables:${extra_table}",
        order: "extra_fields.order_pos",
        jsonFile: true,
        appendToJson: "extra_fields",
      },
    },
  },
};

function printOutput(level, message) {
  if (level <= verboseLevel) console.log(message);
}

function parseDateTimeString(s) {
  if (!s) return null;
  var b = s.split(/\D+/);
  return new Date(b[0], --b[1], b[2], b[3], b[4], b[5]);
}

function buildDateTimeString(d) {
  var tzo = -d.getTimezoneOffset(),
    dif = tzo >= 0 ? "+" : "-",
    pad = function (num) {
      var norm = Math.floor(Math.abs(num));
      return (norm < 10 ? "0" : "") + norm;
    };
  return (
    d.getFullYear() +
    "-" +
    pad(d.getMonth() + 1) +
    "-" +
    pad(d.getDate()) +
    " " +
    pad(d.getHours()) +
    ":" +
    pad(d.getMinutes()) +
    ":" +
    pad(d.getSeconds())
  );
}

function evaluateTemplate(template, obj) {
  for (const key in obj) template = template.split("${" + key + "}").join(obj[key]);
  return template;
}

function printFileStatus(filename, status) {
  let tmp = "* " + filename;
  while (tmp.length < 60) tmp += ".";
  tmp += ": " + status;
  printOutput(2, tmp);
}

async function putElement(elementInfo, element, mtime) {
  if (readOnly) return;

  // Build object to save
  const obj = {};
  for (const updateField of elementInfo.updateFields) obj[updateField] = element[updateField];
  for (const scriptFile of elementInfo.scriptFiles) obj[scriptFile] = fs.readFileSync(targetPath + element.filename + "." + scriptFile + ".crmscript", "utf8");

  if (elementInfo.hasRegisteredUpdated) obj.updated = buildDateTimeString(mtime);
  if (noPut === false) {
    const response = await axios.post(endpoint + "&table=" + elementInfo.table, obj);
  }
}

function createFolderAndFile(filename, data, mtime) {
  if (data) {
    const targetFolder = path.dirname(filename);
    fs.mkdirSync(targetFolder, { recursive: true });

    // Write file if content is different. We ignore \r in comparing. Skip .json files if so asked.
    if (ignoreJSONFiles === false || path.extname(filename).toLowerCase() !== ".json") {
      let existingData = null;
      if (fs.existsSync(filename))
        existingData = fs.readFileSync(filename, 'utf8').replace(/\r/g, "");
      if (existingData !== data.replace(/\r/g, "")) {
        fs.writeFileSync(filename, data);
      }
      if (mtime) fs.utimesSync(filename, mtime, mtime);
    }

    knownFiles[filename] = true;
  }
}

function getAttributesExceptScriptfiles(elementInfo, element) {
  // Copy out all attributes from element, except the ones in scriptFiles
  const obj = {};
  for (const key in element) {
    if (!elementInfo.scriptFiles || elementInfo.scriptFiles.indexOf(key) < 0) obj[key] = element[key];
  }

  return obj;
}

// Special code to append to INFO.html file
function appendToNavigationFile(filename, element) {
  if (!(filename in memoryFile))
    memoryFile[filename] = { data: "" };

  let indent = memoryFile[filename].indent || 0;
  if (element.element_type === 301) indent--;
  else {
    let line =
      "    ".repeat(indent) +
      elementTypes.elementTypes["_" + element.element_type] +
      ": " +
      (element.name ? element.name : "(no name)") +
      " <a href='./screen_definition_element/" +
      path.basename(element.filename) +
      ".json'></a><br>\r\n";
    memoryFile[filename].data += line;
    if (element.element_type >= 201 && element.element_type < 300) indent++;
  }
  memoryFile[filename].indent = indent;
}

function writeMemoryFiles() {
  for (filename in memoryFile) {
    let data = memoryFile[filename].data;
    if (typeof data !== "string")
      data = JSON.stringify(data, null, 4);
    createFolderAndFile(filename, data, memoryFile[filename].mtime);
  }
  memoryFile = {}
}

async function getElement(elementInfo, element) {
  if (readOnly) return;

  // Special hardcoded rules for now
  if (elementInfo.table === "item_config" && element.item_name === "body") {
    createFolderAndFile(targetPath + element.filename + ".body.crmscript", element.item_value, element.mtime);
    return;
  }

  // Build main json file
  const jsonFilename = targetPath + element.filename + ".json";
  if (elementInfo.jsonFile === true) {
    const data = getAttributesExceptScriptfiles(elementInfo, element);
    if (elementInfo.appendToJson) {
      if (!(jsonFilename in memoryFile))
        memoryFile[jsonFilename] = { data: {} };

      json = memoryFile[jsonFilename].data;
      json[elementInfo.appendToJson] = json[elementInfo.appendToJson] || [];
      json[elementInfo.appendToJson].push(data);
    }
    else {
      memoryFile[jsonFilename] = { data: data, mtime: element.mtime };
    }

    // Create navigation file for screen_definition
    if (elementInfo.table === "screen_definition_element") {
      let folder = path.dirname(targetPath + element.filename).split("/");
      folder = folder.splice(0, folder.length - 1);
      appendToNavigationFile(folder.join("/") + "/_elements.html", element);
    }
  }

  // Build script files
  if (elementInfo.scriptFiles)
    for (const scriptFile of elementInfo.scriptFiles)
      createFolderAndFile(targetPath + element.filename + "." + scriptFile + ".crmscript", element[scriptFile], element.mtime);
}

// Get the newest mtime for any of the files used to store the element
function getMtimeForElement(elementInfo, element) {
  const files = [];
  if (elementInfo.jsonFile === true) files.push(targetPath + element.filename + ".json");
  if (elementInfo.scriptFiles)
    for (const scriptFile of elementInfo.scriptFiles) files.push(targetPath + element.filename + "." + scriptFile + ".crmscript");

  let mtime = null;
  for (file of files) {
    if (fs.existsSync(file)) {
      const tmp = fs.statSync(file).mtime;
      if (tmp > mtime) {
        mtime = tmp;
        mtime.setSeconds(mtime.getSeconds(), 0); // Clear milliseconds
      }
    }
  }
  return mtime;
}

async function checkElement(elementInfo, element, method) {
  const mtime = getMtimeForElement(elementInfo, element);

  if (method === "status") {
    if (element.mtime === null) printFileStatus(element.filename, "     no date in database");
    else if (element.mtime > mtime || mtime === null) printFileStatus(element.filename, "(<== database)");
    else if (element.mtime < mtime) printFileStatus(element.filename, "(==> database)");
    else printFileStatus(element.filename, "     unchanged");
  } else if (method === "get") {
    printFileStatus(element.filename, " <== forced get");
    await getElement(elementInfo, element);
  } else if (method === "put") {
    printFileStatus(element.filename, " ==> forced put");
    await putElement(elementInfo, element, mtime);
  } else if (method === "sync") {
    if (element.mtime === null) printFileStatus(element.filename, "     no date in database, cannot sync");
    else if (element.mtime > mtime || mtime === null) {
      printFileStatus(element.filename, " <== database");
      await getElement(elementInfo, element);
      syncReceivedFiles.push(element.filename);
    } else if (element.mtime < mtime) {
      printFileStatus(element.filename, " ==> database");
      await putElement(elementInfo, element, mtime);
      syncSentFiles.push(element.filename);
    } else printFileStatus(element.filename, "     unchanged");
  }
}

String.prototype.myReplaceAll = function (search, replacement) {
  var target = this;
  return target.split(search).join(replacement);
};

async function checkElements(elementInfo, elements, method) {
  if (elements && Array.isArray(elements)) {
    let counter = 1;
    for (const element of elements) {
      if (verboseLevel >= 1) process.stdout.write("\r - " + elementInfo.table + ": " + counter + "/" + elements.length);
      counter++;
      // Special hardcoded conversion of extra_fields on regular tables
      if (elementInfo.table === "extra_fields" && element.domain !== 16) {
        element.filename =
          "extra_tables/" +
          {
            _1: "person",
            _2: "contact",
            _4: "ticket",
            _8: "ej_message",
            _32: "ejuser",
            _64: "ej_category",
            _128: "kb_entry",
            _256: "kb_category",
          }["_" + element.domain];
      }

      if (element.filename) {
      } // Do nothing
      else if (elementInfo.filename) element.filename = evaluateTemplate(elementInfo.filename, element);
      else if (elementInfo.filenameLookup) element.filename = filenamesMap[evaluateTemplate(elementInfo.filenameLookup, element)];
      else element.filename = element.folder + "/" + element.name;
      if (elementInfo.hasRegisteredUpdated === true) element.mtime = parseDateTimeString(element.updated ? element.updated : element.registered);

      if (element.filename) {
        element.filename = element.filename.replace("//", "/"); // Fix for files on root, where folder will become //

        // Escape illegal characters in filename
        const charsToEscape = ".$:\"<>#%&{}!@";
        for (let i = 0; i < charsToEscape.length; i++) {
          element.filename = element.filename.myReplaceAll(charsToEscape[i], "_");
        }
        filenamesMap[elementInfo.table + ":" + element.id] = element.filename; // Remember filename in case children use it
        await checkElement(elementInfo, element, method);
      }
    }
    if (verboseLevel >= 1) process.stdout.write("...done\r\n");
  }
}

// Add where clause to url, by automatically finding next correct index (whereField.0, whereField.1, etc)
function addWhereClause(url, field, operator, value) {
  var index = 0;
  while (url.indexOf("whereField." + index) >= 0) index++;

  url +=
    "&whereField." +
    index +
    "=" +
    encodeURIComponent(field) +
    "&whereOperator." +
    index +
    "=" +
    encodeURIComponent(operator) +
    "&whereValue." +
    index +
    "=" +
    encodeURIComponent(value);

  return url;
}

function getAllFiles(allFiles, path) {
  const entries = fs.readdirSync(path, { withFileTypes: true });
  for (const entry of entries) {
    const name = path + "/" + entry.name;
    if (entry.isDirectory()) getAllFiles(allFiles, name);
    else allFiles[name] = true;
  }
}

function deleteUnknownFiles(path) {
  const allFiles = {};
  getAllFiles(allFiles, path)
  for (const filename in allFiles) {
    if (!(filename in knownFiles)) {
      printOutput(1, "Deleting unknown file: " + filename);
      fs.unlinkSync(filename);
    }
  }
}

async function doTable(elementInfo, elementType, method, pathStartsWith, isTopLevel) {
  printOutput(2, "doTable: " + elementType);

  elementInfo.table = elementType; // Update elementInfo to know it's own table/name

  let url =
    endpoint +
    "&table=" +
    encodeURIComponent(elementType) +
    "&fields=" +
    encodeURIComponent(elementInfo.fields) +
    "&json=" +
    encodeURIComponent(elementInfo.json);

  // Add path restriction
  if (pathStartsWith != "") url = addWhereClause(url, elementInfo.folderField, "beginsWith", pathStartsWith);

  // Add custom where clauses
  if (elementInfo.where) {
    for (const where of elementInfo.where) url = addWhereClause(url, where.field, where.operator, where.value);
  }

  // Add order
  if (elementInfo.order) {
    url += "&order=" + encodeURIComponent(elementInfo.order);
  }

  printOutput(3, url);
  options.url = url;
  const response = await client({ method: 'get', url: url });
  printOutput(3, response.data);
  await checkElements(elementInfo, response.data[elementType], method);

  // Sub tables
  for (const child in elementInfo.children) await doTable(elementInfo.children[child], child, method, pathStartsWith);

  if (isTopLevel) {
    // Navigation files
    writeMemoryFiles();

    // Clean folder if required. Only for method "get"
    if (cleanFolders && method === "get" && elementInfo.cleanFolder)
      deleteUnknownFiles(targetPath + elementInfo.cleanFolder);
  }
}

function usage(error) {
  if (error)
    printOutput(0, error);
  printOutput(
    0,
    "Usage: node ExpanderSync [-e endpoint] [-m 'status'|'sync'|'get'|'put'] [-y elementType,elementType|'ejscript'][-p pathStartsWith] [-t targetPath] [-v verboseLevel|1] [--cleanFolder] [--noPut] [--ignoreJSONFiles]"
  );
}

async function main() {
  const myArgs = process.argv.slice(2);
  const methods = ["status", "sync", "get", "put"];
  let elementTypes = "ejscript";
  let method = "";
  let pathStartsWith = "";

  for (var i = 0; i < myArgs.length; i++) {
    if (myArgs[i] === "-e" && i + 1 < myArgs.length) endpoint = myArgs[++i];
    else if (myArgs[i] === "-m" && i + 1 < myArgs.length) method = myArgs[++i];
    else if (myArgs[i] === "-p" && i + 1 < myArgs.length) pathStartsWith = myArgs[++i];
    else if (myArgs[i] === "-t" && i + 1 < myArgs.length) targetPath = myArgs[++i];
    else if (myArgs[i] === "-y" && i + 1 < myArgs.length) elementTypes = myArgs[++i];
    else if (myArgs[i] === "-v" && i + 1 < myArgs.length) verboseLevel = parseInt(myArgs[++i]);
    else if (myArgs[i] === "--cleanFolders") cleanFolders = true;
    else if (myArgs[i] === "--noPut") noPut = true;
    else if (myArgs[i] === "--ignoreJSONFiles") ignoreJSONFiles = true;
    else if (myArgs[i] === "--ejscriptCorrectFolder") dbToDisk.ejscript.filename = "ejscript/${folder}/${name}"; // No separate subfolder per script
    else return usage("Error: unknown parameter: " + myArgs[i]);
  }

  if (methods.indexOf(method) < 0 || !endpoint) return usage();

  if (noPut) printOutput(0, "noPut is true, no files will be pushed to server!");

  printOutput(1, ""); // Blank line
  const tmp = elementTypes.split(",");
  for (elementType of tmp) {
    printOutput(1, "ElementType: " + elementType);
    if (!(elementType in dbToDisk)) {
      printOutput(0, "Unsupported element type: " + elementType);
      return;
    }

    await doTable(dbToDisk[elementType], elementType, method, pathStartsWith, true);
  }

  if (method === "sync" && verboseLevel < 2) {
    if (syncSentFiles.length > 0)
      printOutput(0, "Sent files: \r\n- " + syncSentFiles.join("\r\n- ") + "\r\n");
    else
      printOutput(0, "No sent files");
    if (syncReceivedFiles.length > 0)
      printOutput(0, "Received files: \r\n- " + syncReceivedFiles.join("\r\n- ") + "\r\n");
    else
      printOutput(0, "No received files");
  }

  printOutput(1, "Done"); // Blank line
}

main();
