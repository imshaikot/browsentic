#!/usr/bin/env node
// new-action.mjs — scaffold, wire, verify, and remove VoiceLink actions.
//
// One action == one page capability == one MCP tool. This driver does the
// three edits that must stay in lockstep (the action module, the registry
// import, the registry array) correct-by-construction, then runs the same
// checks a reviewer would (`npm run compile` + the bundled tool manifest) and
// asserts the new tool actually materialized.
//
// Usage (paths are relative to the repo root):
//   node .claude/skills/add-action/new-action.mjs create <name> "<description>"
//   node .claude/skills/add-action/new-action.mjs verify [<name>]
//   node .claude/skills/add-action/new-action.mjs remove <name>
//   node .claude/skills/add-action/new-action.mjs docs
//
// <name> is either a bare camelCase verb (`getAttribute`, namespaced to
// `page.`) or a full `namespace.name` (`page.getAttribute`). Underscores are
// rejected — they break the reversible action-name <-> MCP-tool-name mapping.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..', '..'); // .claude/skills/add-action -> repo root
const REGISTRY = join(ROOT, 'lib/actions/registry.ts');
const PAGE_DIR = join(ROOT, 'lib/actions/page');

const CAP_DOCS = [
  { path: '.claude/skills/voicelink/SKILL.md', hint: 'the count in "There are N page tools" + section 8' },
  { path: 'README.md', hint: 'the action table under "## The action layer"' },
  { path: 'CLAUDE.md', hint: 'the "Map of all N actions" count in the action-layer section' },
];

const die = (msg) => {
  console.error(`\x1b[31m✗ ${msg}\x1b[0m`);
  process.exit(1);
};
const ok = (msg) => console.log(`\x1b[32m✓\x1b[0m ${msg}`);
const info = (msg) => console.log(`  ${msg}`);

// camelCase -> kebab-case: getAttribute -> get-attribute, getPageInfo -> get-page-info
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

/** Parse & validate a name into its parts, or die with a precise reason. */
function parseName(raw) {
  if (!raw) die('Missing <name>. Try: create getAttribute "Read an attribute from an element"');
  if (raw.includes('_')) {
    die(`"${raw}" contains "_". MCP tool names use "_" as the namespace separator, so an ` +
      `underscore in an action name is irreversible. Use camelCase (getAttribute).`);
  }
  const dot = raw.indexOf('.');
  const namespace = dot === -1 ? 'page' : raw.slice(0, dot);
  const local = dot === -1 ? raw : raw.slice(dot + 1);
  if (local.includes('.')) die(`"${raw}" has more than one "." — use namespace.name (page.getAttribute)`);
  if (!/^[a-z][a-zA-Z0-9]*$/.test(local)) {
    die(`Action name "${local}" must be camelCase starting with a lowercase letter (getAttribute)`);
  }
  if (!/^[a-z][a-zA-Z0-9]*$/.test(namespace)) die(`Namespace "${namespace}" must be camelCase`);
  return {
    namespace,
    local,                                // export const name, e.g. getAttribute
    actionName: `${namespace}.${local}`,  // page.getAttribute
    toolName: `${namespace}_${local}`,    // page_getAttribute (the MCP tool)
    file: join(PAGE_DIR, `${kebab(local)}.ts`),
    relFile: `lib/actions/page/${kebab(local)}.ts`,
    importPath: `./page/${kebab(local)}`,
  };
}

const TEMPLATE = (n, description) => `import { z } from 'zod';
import { ActionError, defineAction } from '../core';
import { describeElement, resolveTarget, targetSchema } from './dom';

export const ${n.local} = defineAction({
  name: '${n.actionName}',
  description: ${JSON.stringify(description)},
  input: z.object({
    // .describe() EVERY field — this text becomes the MCP tool's parameter docs.
    target: targetSchema.describe('Element to act on'),
    // Example option. Rename or delete. No .refine()/.transform(): they don't
    // survive z.toJSONSchema(), so the MCP manifest would silently lose them.
    example: z.string().default('').describe('Replace with a real parameter'),
  }),
  execute({ target, example }) {
    // Touch document/window ONLY in here. A top-level DOM reference throws when
    // the registry is imported in plain Node — that is what verify (mcp:manifest) catches.
    const el = resolveTarget(target); // throws TARGET_NOT_FOUND if nothing matches
    // Validate anything the schema can't express with a stable code:
    // INVALID_INPUT | INVALID_TARGET | TARGET_NOT_FOUND | TIMEOUT | UNSUPPORTED
    if (!(el instanceof HTMLElement)) {
      throw new ActionError('Target is not an element we can act on', 'INVALID_TARGET');
    }
    // ...do the side effect here (dispatch events, read attributes, etc.)...
    // Return a SMALL, JSON-serializable result — it crosses sendMessage, so no DOM nodes.
    return { element: describeElement(el), example };
  },
});
`;

function readRegistry() {
  if (!existsSync(REGISTRY)) die(`registry not found at ${REGISTRY} — run from inside the repo`);
  return readFileSync(REGISTRY, 'utf8');
}

/** Insert the page-import line alphabetically by symbol, else after the last one. */
function addImport(src, n) {
  const line = `import { ${n.local} } from '${n.importPath}';`;
  if (src.includes(line)) return src;
  const imports = [...src.matchAll(/^import \{ (\w+) \} from '\.\/page\/[^']+';$/gm)];
  if (imports.length === 0) die('could not find the ./page import block in registry.ts');
  const before = imports.find((m) => m[1] > n.local);
  if (before) return src.slice(0, before.index) + line + '\n' + src.slice(before.index);
  const last = imports[imports.length - 1];
  const at = last.index + last[0].length;
  return src.slice(0, at) + '\n' + line + src.slice(at);
}

/** Insert the export symbol into the actions array, before its closing bracket. */
function addToArray(src, n) {
  const close = src.indexOf('] as AnyAction[]');
  if (close === -1) die('could not find "] as AnyAction[]" in registry.ts');
  const lineStart = src.lastIndexOf('\n', close) + 1;
  const indent = src.slice(lineStart, close).match(/^\s*/)[0] + '  ';
  return src.slice(0, lineStart) + `${indent}${n.local},\n` + src.slice(lineStart);
}

function removeImport(src, n) {
  return src.replace(new RegExp(`^import \\{ ${n.local} \\} from '${n.importPath.replace(/[/.]/g, '\\$&')}';\\n`, 'm'), '');
}
function removeFromArray(src, n) {
  return src.replace(new RegExp(`^\\s*${n.local},\\n`, 'm'), '');
}

/** Build the MCP bundle and return the parsed tool manifest (no browser needed). */
function toolManifest() {
  try {
    execFileSync('npm', ['--prefix', 'mcp', 'run', 'build', '--silent'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (e) {
    die(`mcp build failed:\n${e.stderr?.toString() ?? e.message}`);
  }
  let out;
  try {
    out = execFileSync('node', ['mcp/dist/cli.js', 'tools'], { cwd: ROOT, encoding: 'utf8' });
  } catch (e) {
    // assertToolNamesRoundTrip / top-level-DOM errors surface here.
    die(`tool manifest failed (this is the top-level-DOM & tool-name check):\n${e.stderr?.toString() ?? e.message}`);
  }
  const start = out.indexOf('[');
  try {
    return JSON.parse(out.slice(start));
  } catch {
    die(`could not parse tool manifest:\n${out}`);
  }
}

function typecheck() {
  try {
    execFileSync('npm', ['run', 'compile'], { cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'] });
    ok('npm run compile — type-check passed');
  } catch (e) {
    die(`npm run compile failed:\n${e.stdout?.toString() ?? ''}${e.stderr?.toString() ?? e.message}`);
  }
}

function docReport(tools) {
  console.log('\n\x1b[1mCapability docs to keep in sync\x1b[0m (there are now ' + tools.length + ' actions):');
  for (const d of CAP_DOCS) info(`• ${d.path} — ${d.hint}`);
  console.log('\nPaste-ready README table row (edit the effect text):');
  const last = tools[tools.length - 1];
  info(`| \`${last.action}\` | ${last.description} |`);
}

// ---- commands -------------------------------------------------------------

function cmdCreate(rawName, description) {
  const n = parseName(rawName);
  if (!description) die('Missing "<description>". One line, present tense: "Read an attribute from an element."');
  if (existsSync(n.file)) die(`${n.relFile} already exists — pick another name or edit it directly`);
  let src = readRegistry();
  if (src.includes(`from '${n.importPath}'`)) die(`registry already imports ${n.local}`);

  writeFileSync(n.file, TEMPLATE(n, description));
  ok(`wrote ${n.relFile}`);
  src = addToArray(addImport(src, n), n);
  writeFileSync(REGISTRY, src);
  ok(`wired ${n.local} into lib/actions/registry.ts (import + actions array)`);

  console.log('\nVerifying the new tool is published…');
  verify(n);
  console.log(`\n\x1b[1mNext:\x1b[0m edit ${n.relFile} (replace the "example" field and the execute body),`);
  console.log(`then re-run:  node ${relSelf()} verify ${n.local}`);
}

function verify(n) {
  typecheck();
  const tools = toolManifest();
  if (n) {
    const t = tools.find((x) => x.action === n.actionName);
    if (!t) die(`${n.actionName} is NOT in the manifest — did you add it to the actions array?`);
    ok(`manifest publishes it as MCP tool "${t.name}" (action ${t.action})`);
    const params = Object.keys(t.inputSchema?.properties ?? {});
    info(`params: ${params.join(', ') || '(none)'}`);
    const undocumented = params.filter((p) => !t.inputSchema.properties[p].description);
    if (undocumented.length) console.warn(`  \x1b[33m! missing .describe(): ${undocumented.join(', ')}\x1b[0m`);
  }
  ok(`manifest OK — ${tools.length} tools total`);
  docReport(tools);
}

function cmdRemove(rawName) {
  const n = parseName(rawName);
  let src = readRegistry();
  src = removeFromArray(removeImport(src, n), n);
  writeFileSync(REGISTRY, src);
  if (existsSync(n.file)) { unlinkSync(n.file); ok(`deleted ${n.relFile}`); }
  ok(`unwired ${n.local} from registry.ts`);
  typecheck();
  const tools = toolManifest();
  ok(`manifest OK — ${tools.length} tools total`);
}

const relSelf = () => '.claude/skills/add-action/new-action.mjs';

const [cmd, name, description] = process.argv.slice(2);
switch (cmd) {
  case 'create': cmdCreate(name, description); break;
  case 'verify': verify(name ? parseName(name) : null); break;
  case 'remove': cmdRemove(name); break;
  case 'docs': docReport(toolManifest()); break;
  default:
    console.log(`new-action.mjs — author a VoiceLink action (== page capability == MCP tool)

  create <name> "<description>"   scaffold + wire registry + verify
  verify [<name>]                 compile + build manifest, assert <name> is published
  remove <name>                   unwire + delete (clean back-out)
  docs                            list the capability docs to keep in sync

  <name>: camelCase verb (getAttribute) or namespace.name (page.getAttribute). No underscores.`);
    process.exit(cmd ? 1 : 0);
}
