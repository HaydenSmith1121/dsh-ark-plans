#!/usr/bin/env node
/**
 * Guard the one invariant this plugin cannot express in types: the catalog in
 * `lib/index.js` and the `models:` lists in `cordis.patch.yml` must agree.
 *
 * They are two representations of the same fact. The patch is what pi-ai actually
 * serves on a fresh install; the JS table is what the management page offers and what
 * an enable/disable write restores. If they drift, a user can enable a model the patch
 * never declared (so it 404s) or silently lose one the page does not know about.
 *
 * This script is deliberately dependency-free — it parses the YAML with a small
 * purpose-built reader rather than adding a parser, because the subset used here
 * (`- insert:` / `- id:` / nested `models:` with `id:` / `name:` / `contextWindow:`)
 * is tiny and fixed.
 *
 * Usage: node scripts/check-catalog.mjs   (exit 1 on drift)
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

/** Read the CATALOG table out of lib/index.js without importing it (no dsh runtime here). */
async function readCatalogFromSource() {
  const source = await readFile(join(root, 'lib', 'index.js'), 'utf8')
  const marker = 'const CATALOG = '
  const start = source.indexOf(marker)
  if (start === -1) throw new Error('CATALOG not found in lib/index.js')

  // Walk braces from the opening `{` so a nested object's closing brace cannot end
  // the slice early. The literal is plain data with no braces inside strings.
  const open = source.indexOf('{', start)
  if (open === -1) throw new Error('CATALOG has no object literal')
  let depth = 0
  let end = -1
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        end = i
        break
      }
    }
  }
  if (end === -1) throw new Error('CATALOG object literal is not terminated')

  const literal = source.slice(open, end + 1)
  // eslint-disable-next-line no-new-func
  return new Function(`return (${literal})`)()
}

/**
 * Parse the `providers:` block of cordis.patch.yml into route → model entries.
 *
 * Indentation of the block this file declares (verified against the real file):
 *
 *     - id: llm-pi-ai
 *       config:
 *         providers:                # 4
 *           ark-agent-plan:         # 6
 *             models:               # 8
 *               - id: …             # 10
 *                 name: …           # 12
 *                 contextWindow: …  # 12
 *
 * Only the shapes this file uses are understood; an unexpected model field throws
 * rather than being skipped, so a hand-edit that changes the structure fails loudly.
 */
async function readCatalogFromPatch() {
  const text = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
  const lines = text.split(/\r?\n/)

  let inProviders = false
  const providerIndent = 4
  let currentRoute = null
  let inModels = false
  let current = null
  const routes = {}

  const flush = () => {
    if (currentRoute !== null && current !== null) routes[currentRoute].push(current)
    current = null
  }

  for (const line of lines) {
    if (/^\s*#/.test(line) || line.trim() === '') continue

    if (/^ {4}providers:\s*$/.test(line)) {
      inProviders = true
      continue
    }
    if (!inProviders) continue

    const indent = line.match(/^ */)[0].length
    // A line at or above `providers:` depth ends the block.
    if (indent <= providerIndent) break

    const route = line.match(/^ {6}([A-Za-z0-9_.-]+):\s*$/)
    if (route !== null) {
      flush()
      currentRoute = route[1]
      routes[currentRoute] = routes[currentRoute] ?? []
      inModels = false
      continue
    }
    if (/^ {8}models:\s*$/.test(line)) {
      inModels = true
      continue
    }
    if (!inModels || currentRoute === null) continue
    if (indent <= 8) {
      inModels = false
      continue
    }

    const entryId = line.match(/^ {10}- id:\s*(\S+)\s*$/)
    if (entryId !== null) {
      flush()
      current = { id: entryId[1] }
      continue
    }
    if (current === null) continue

    const name = line.match(/^ {12}name:\s*(.+?)\s*$/)
    if (name !== null) {
      current.name = name[1].replace(/^["']|["']$/g, '')
      continue
    }
    const ctxWindow = line.match(/^ {12}contextWindow:\s*(\d+)\s*$/)
    if (ctxWindow !== null) {
      current.contextWindow = Number(ctxWindow[1])
      continue
    }
    // Any other model field is one this guard does not model; refuse rather than
    // compare a partially-understood entry.
    if (/^ {12}\S/.test(line)) {
      throw new Error(`unexpected model field in cordis.patch.yml: ${line.trim()}`)
    }
  }
  flush()
  return routes
}

/** Compare two ordered entry lists, reporting the first difference precisely. */
function compare(route, fromPatch, fromSource) {
  const problems = []
  if (fromPatch.length !== fromSource.length) {
    problems.push(`  ${route}: patch has ${fromPatch.length} model(s), lib/index.js has ${fromSource.length}`)
  }
  const max = Math.max(fromPatch.length, fromSource.length)
  for (let i = 0; i < max; i += 1) {
    const a = fromPatch[i]
    const b = fromSource[i]
    if (a === undefined || b === undefined) {
      problems.push(`  ${route}[${i}]: only one side has an entry (${JSON.stringify(a ?? b)})`)
      continue
    }
    if (a.id !== b.id) {
      problems.push(`  ${route}[${i}]: id "${a.id}" (patch) vs "${b.id}" (source)`)
      continue
    }
    if (a.name !== b.name) {
      problems.push(`  ${route}[${i}] "${a.id}": name "${a.name}" vs "${b.name}"`)
    }
    if (a.contextWindow !== b.contextWindow) {
      problems.push(`  ${route}[${i}] "${a.id}": contextWindow ${a.contextWindow} vs ${b.contextWindow}`)
    }
  }
  return problems
}

const patch = await readCatalogFromPatch()
const source = await readCatalogFromSource()

const problems = []
const patchRoutes = Object.keys(patch).sort()
const sourceRoutes = Object.keys(source).sort()

if (patchRoutes.join(',') !== sourceRoutes.join(',')) {
  problems.push(`  routes differ: patch [${patchRoutes}] vs source [${sourceRoutes}]`)
}
for (const route of sourceRoutes) {
  if (!patchRoutes.includes(route)) continue
  problems.push(...compare(route, patch[route], source[route]))
}

if (problems.length > 0) {
  console.error('catalog drift between cordis.patch.yml and lib/index.js:')
  for (const line of problems) console.error(line)
  process.exit(1)
}

const total = sourceRoutes.reduce((n, route) => n + source[route].length, 0)
console.log(`catalog ok — ${sourceRoutes.length} route(s), ${total} model(s) in agreement`)
