// Synthetic starter fixtures. Deliberately incomplete; never production data.
export const catalog = {
  typo: {
    allowed: ["README.md"],
    spec: "Correct exactly 'Save chagnes' to 'Save changes' in README.md. Preserve all other content.",
    files: {
      "README.md": "# Task board\n\nClick **Save chagnes** to keep your edits.\n",
      "TASK.md":
        "# Synthetic assignment\n\nCorrect exactly 'Save chagnes' to 'Save changes' in README.md. Preserve all other content.\n\nWork only in this assigned directory. Follow the repository's existing agent policy supplied by the coordinator. Do not read other arms, evaluator code, or session logs; do not install dependencies, access the network, capture memory, commit, or publish. Preserve tests and unrelated files. Use built-in Node.js for checks.\n",
    },
  },
  adapters: {
    allowed: ["json.mjs", "csv.mjs", "summary.mjs"],
    spec: "Implement parseJson(text) in json.mjs and parseCsv(text) in csv.mjs. Both return an array of {id,title} records. Fields must be nonempty strings after trimming; reject invalid inputs/records with TypeError. IDs must be unique after trimming, case-sensitive. Do not mutate inputs. parseJson accepts a JSON string containing an array of objects; extra fields are ignored. Invalid JSON throws TypeError. parseCsv accepts a string with exact id,title header, two columns per row, comma delimiters, LF/CRLF rows, quoted fields including commas/newlines and doubled quote escapes. Ignore completely empty physical rows outside quotes. Reject malformed quoting, wrong headers and wrong column counts with TypeError. Empty/header-only CSV yields [] only when the header is present; empty text is invalid. Quoted header names id,title are allowed. Space after a closing quote is invalid.\nImplement summarize(format,text) in summary.mjs using the adapters: return {count, titles} with titles sorted by JavaScript default string sort. Only formats json and csv are accepted; otherwise throw TypeError. Public exports must stay named as specified.\nThe contract above is fixed. JSON and CSV adapters can be implemented independently; summary integration depends on both. Only json.mjs, csv.mjs, summary.mjs are writable.",
    files: {
      "json.mjs": "export function parseJson(text) { return JSON.parse(text); }\n",
      "csv.mjs":
        "export function parseCsv(text) { return text.split('\\n').slice(1).map(row=>{const [id,title]=row.split(',');return {id,title};}); }\n",
      "summary.mjs": "export function summarize() { return {count:0,titles:[]}; }\n",
      "legacy-export.mjs":
        "// Unrelated export path; leave unchanged.\nexport const exportFormat = 'tsv';\n",
      "visible.test.mjs":
        "import assert from 'node:assert/strict';\nimport {parseJson} from './json.mjs';\nimport {parseCsv} from './csv.mjs';\nimport {summarize} from './summary.mjs';\nassert.deepEqual(parseJson('[{\"id\":\" a \",\"title\":\" One \"}]'),[{id:'a',title:'One'}]);\nassert.deepEqual(parseCsv('id,title\\na,One'),[{id:'a',title:'One'}]);\nassert.deepEqual(summarize('json','[{\"id\":\"a\",\"title\":\"One\"}]'),{count:1,titles:['One']});\n",
      "TASK.md":
        "# Synthetic assignment\n\nImplement parseJson(text) in json.mjs and parseCsv(text) in csv.mjs. Both return an array of {id,title} records. Fields must be nonempty strings after trimming; reject invalid inputs/records with TypeError. IDs must be unique after trimming, case-sensitive. Do not mutate inputs. parseJson accepts a JSON string containing an array of objects; extra fields are ignored. Invalid JSON throws TypeError. parseCsv accepts a string with exact id,title header, two columns per row, comma delimiters, LF/CRLF rows, quoted fields including commas/newlines and doubled quote escapes. Ignore completely empty physical rows outside quotes. Reject malformed quoting, wrong headers and wrong column counts with TypeError. Empty/header-only CSV yields [] only when the header is present; empty text is invalid. Quoted header names id,title are allowed. Space after a closing quote is invalid.\nImplement summarize(format,text) in summary.mjs using the adapters: return {count, titles} with titles sorted by JavaScript default string sort. Only formats json and csv are accepted; otherwise throw TypeError. Public exports must stay named as specified.\nThe contract above is fixed. JSON and CSV adapters can be implemented independently; summary integration depends on both. Only json.mjs, csv.mjs, summary.mjs are writable.\n\nWork only in this assigned directory. Follow the repository's existing agent policy supplied by the coordinator. Do not read other arms, evaluator code, or session logs; do not install dependencies, access the network, capture memory, commit, or publish. Preserve tests and unrelated files. Use built-in Node.js for checks; run node visible.test.mjs.\n",
    },
  },
  ingestion: {
    allowed: ["store.mjs", "ingest.mjs", "search.mjs"],
    spec: "Repair the miniature ingestion system across store.mjs, ingest.mjs, search.mjs. createStore() returns a Map. ingest(store,projectId,sourceId,content) returns true only on a create or content change, false for unchanged re-ingestion. It stores exactly one {projectId,sourceId,content} per project/source pair; IDs are exact nonempty strings, content is a string (including empty). Throw TypeError for invalid IDs, content or non-Map store. Identifiers may contain separators. search(store,projectId,query) returns only records in that exact project whose content contains the case-sensitive query, sorted by sourceId using JavaScript lexical ordering. Empty query matches all within that project. Validate Map, nonempty projectId, and string query with TypeError. Search results are detached copies: changing one cannot mutate the store. Changed content must be visible immediately; unchanged content must not duplicate records.\nPreserve named exports and the upsert(store,record) helper signature. Only store.mjs, ingest.mjs and search.mjs are writable.",
    files: {
      "store.mjs":
        "export function createStore() { return new Map(); }\nexport function upsert(store,record) { store.set(record.sourceId,record);return true; }\n",
      "ingest.mjs":
        "import {upsert} from './store.mjs';\nexport function ingest(store,projectId,sourceId,content) {return upsert(store,{projectId,sourceId,content});}\n",
      "search.mjs":
        "export function search(store,projectId,query) {return [...store.values()].filter(r=>r.content.includes(query));}\n",
      "archive.mjs":
        "// Unrelated archive policy; leave unchanged.\nexport const retentionDays=30;\n",
      "visible.test.mjs":
        "import assert from 'node:assert/strict';\nimport {createStore} from './store.mjs';\nimport {ingest} from './ingest.mjs';\nimport {search} from './search.mjs';\nconst store=createStore();\nassert.equal(ingest(store,'alpha','doc','hello'),true);\nassert.equal(ingest(store,'alpha','doc','hello'),false);\nassert.deepEqual(search(store,'beta','hello'),[]);\n",
      "TASK.md":
        "# Synthetic assignment\n\nRepair the miniature ingestion system across store.mjs, ingest.mjs, search.mjs. createStore() returns a Map. ingest(store,projectId,sourceId,content) returns true only on a create or content change, false for unchanged re-ingestion. It stores exactly one {projectId,sourceId,content} per project/source pair; IDs are exact nonempty strings, content is a string (including empty). Throw TypeError for invalid IDs, content or non-Map store. Identifiers may contain separators. search(store,projectId,query) returns only records in that exact project whose content contains the case-sensitive query, sorted by sourceId using JavaScript lexical ordering. Empty query matches all within that project. Validate Map, nonempty projectId, and string query with TypeError. Search results are detached copies: changing one cannot mutate the store. Changed content must be visible immediately; unchanged content must not duplicate records.\nPreserve named exports and the upsert(store,record) helper signature. Only store.mjs, ingest.mjs and search.mjs are writable.\n\nWork only in this assigned directory. Follow the repository's existing agent policy supplied by the coordinator. Do not read other arms, evaluator code, or session logs; do not install dependencies, access the network, capture memory, commit, or publish. Preserve tests and unrelated files. Use built-in Node.js for checks; run node visible.test.mjs.\n",
    },
  },
};
