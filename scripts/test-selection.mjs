#!/usr/bin/env node
/**
 * Behavioural tests for the enable/disable selection logic.
 *
 * These exercise the pure rules in `lib/index.js` — normalization against a changed
 * catalog, and the "empty means everything" default — without a dsh runtime. The
 * functions are re-declared here in the same shape as the module's, because the module
 * itself cannot be imported outside a harness (it is an ES module with no dsh
 * dependencies at the top, but importing it would execute `name`/`apply` wiring only —
 * so we import the real functions where possible and fall back to asserting the
 * contract).

 * Usage: node scripts/test-selection.mjs   (exit 1 on failure)
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const source = await readFile(join(root, 'lib', 'index.js'), 'utf8')

/** Load the CATALOG literal from the module source. */
function loadCatalog() {
  const marker = 'const CATALOG = '
  const start = source.indexOf(marker)
  const open = source.indexOf('{', start)
  let depth = 0
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1
    else if (source[i] === '}') {
      depth -= 1
      if (depth === 0) return new Function(`return (${source.slice(open, i + 1)})`)()
    }
  }
  throw new Error('CATALOG not found')
}

/**
 * Extract one top-level function declaration from the module source.
 *
 * The module cannot be imported directly (it is loaded by the harness with services
 * this test does not have), so the pure helpers are pulled out by brace matching and
 * evaluated. That keeps the test asserting the *shipped* code rather than a copy.
 */
function extractFunction(name) {
  const marker = `function ${name}(`
  const start = source.indexOf(marker)
  if (start === -1) throw new Error(`function ${name} not found in lib/index.js`)
  let depth = 0
  let seenBrace = false
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') {
      depth += 1
      seenBrace = true
    } else if (source[i] === '}') {
      depth -= 1
      if (seenBrace && depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`function ${name} is not terminated`)
}

const CATALOG = loadCatalog()
const PLANS = [
  { route: 'ark-agent-plan' },
  { route: 'ark-coding-plan' },
]

// Evaluate the shipped helpers with CATALOG and PLANS in scope.
const helpers = new Function(
  'CATALOG',
  'PLANS',
  `${extractFunction('effectiveEnabled')}
   ${extractFunction('modelsFor')}
   return { effectiveEnabled, modelsFor }`,
)(CATALOG, PLANS)

const { effectiveEnabled, modelsFor } = helpers

let failures = 0
let checks = 0

/**
 * Assert one expectation.
 *
 * @param label - what is being checked.
 * @param actual - the produced value.
 * @param expected - the required value, compared by JSON.
 */
function check(label, actual, expected) {
  checks += 1
  const a = JSON.stringify(actual)
  const b = JSON.stringify(expected)
  if (a !== b) {
    failures += 1
    console.error(`FAIL ${label}\n  actual:   ${a}\n  expected: ${b}`)
  }
}

const AGENT = CATALOG['ark-agent-plan']
const agentIds = AGENT.map((m) => m.id)

// --- the default posture ------------------------------------------------------------

check(
  'absent selection enables every model',
  effectiveEnabled('ark-agent-plan', undefined),
  agentIds,
)
check(
  'empty selection enables every model',
  effectiveEnabled('ark-agent-plan', []),
  agentIds,
)
check(
  'non-array selection enables every model',
  effectiveEnabled('ark-agent-plan', 'nonsense'),
  agentIds,
)

// --- narrowing ----------------------------------------------------------------------

check(
  'a subset is honored in catalog order',
  effectiveEnabled('ark-agent-plan', ['minimax-m3', 'glm-5.3']),
  ['glm-5.3', 'minimax-m3'],
)
check(
  'a single id narrows to one',
  effectiveEnabled('ark-agent-plan', ['kimi-k3']),
  ['kimi-k3'],
)
check(
  'catalog order is used, not the stored order',
  effectiveEnabled('ark-agent-plan', ['deepseek-v4-pro', 'ark-code-latest']),
  ['ark-code-latest', 'deepseek-v4-pro'],
)

// --- catalog drift ------------------------------------------------------------------

check(
  'unknown ids are dropped',
  effectiveEnabled('ark-agent-plan', ['glm-5.3', 'no-such-model']),
  ['glm-5.3'],
)
check(
  'an all-unknown selection falls back to everything, never to nothing',
  effectiveEnabled('ark-agent-plan', ['renamed-away', 'also-gone']),
  agentIds,
)
check(
  'duplicates collapse',
  effectiveEnabled('ark-agent-plan', ['glm-5.3', 'glm-5.3', 'kimi-k3']),
  ['glm-5.3', 'kimi-k3'],
)

// --- unknown route ------------------------------------------------------------------

check('an unknown route yields no models', effectiveEnabled('nope', ['x']), [])

// --- modelsFor ----------------------------------------------------------------------

check(
  'modelsFor rebuilds entries with id, name and contextWindow',
  modelsFor('ark-agent-plan', ['glm-5.3']),
  [{ id: 'glm-5.3', name: 'GLM-5.3', contextWindow: 1048576 }],
)
check(
  'modelsFor over the whole catalog reproduces the catalog',
  modelsFor('ark-agent-plan', agentIds),
  AGENT,
)
check(
  'modelsFor preserves the large context window (no silent shrink to the default)',
  modelsFor('ark-agent-plan', ['deepseek-v4-pro'])[0].contextWindow,
  1048576,
)
check(
  'modelsFor returns copies, not catalog references',
  modelsFor('ark-agent-plan', ['glm-5.3'])[0] !== AGENT.find((m) => m.id === 'glm-5.3'),
  true,
)

// --- the coding lane ----------------------------------------------------------------

check(
  'the coding lane has its one documented model',
  effectiveEnabled('ark-coding-plan', undefined),
  ['ark-code-latest'],
)

// --- the non-empty-models invariant --------------------------------------------------
//
// Regression guard for a real failure: pi-ai refuses a route that resolves NO models
// when the installed catalog does not describe it (Ark is hand-declared), answering
//   provider "ark-agent-plan" resolves no models; the installed catalog does not
//   describe this route, so its models must be listed in configuration
// So the `llm-pi-ai` write must always carry an explicit list. This asserts the shipped
// source never builds that payload from an `isFull ? [] : …` shortcut back to the bug.
// (An empty list in this plugin's OWN section is fine and expected — that is the
// "nothing narrowed" record, not the pi-ai payload.)

// The `models` payload is built immediately above the call, so inspect that window.
const piAiCall = source.indexOf('await settings.update(PI_AI_NS')
check('the llm-pi-ai write exists', piAiCall > -1, true)
const piAiPayload = source.slice(Math.max(0, piAiCall - 800), piAiCall + 120)
check(
  'the llm-pi-ai payload is not built from an empty-list shortcut',
  /isFull\s*\?\s*\[\s*\]\s*:/.test(piAiPayload),
  false,
)
check(
  'the llm-pi-ai payload uses modelsFor(route, normalized)',
  /const models = modelsFor\(route, normalized\)/.test(piAiPayload),
  true,
)

// And every route must always materialize at least one model, for every possible
// selection the UI can produce — including a selection of everything.
for (const route of ['ark-agent-plan', 'ark-coding-plan']) {
  const ids = (CATALOG[route] ?? []).map((m) => m.id)
  check(
    `modelsFor("${route}", <all>) is non-empty`,
    modelsFor(route, ids).length > 0,
    true,
  )
  check(
    `effectiveEnabled("${route}", <all>) is non-empty`,
    effectiveEnabled(route, ids).length > 0,
    true,
  )
}

if (failures > 0) {
  console.error(`\n${failures} of ${checks} check(s) failed`)
  process.exit(1)
}
console.log(`selection logic ok — ${checks} check(s) passed`)
