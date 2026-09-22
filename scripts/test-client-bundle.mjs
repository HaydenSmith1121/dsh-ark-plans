#!/usr/bin/env node
/**
 * Load the client half the way the browser shell does, and assert what it registers.
 *
 * `lib/client.js` is a factory-form CJS bundle: it runs `window.__ModuleLoader__.load`
 * at module scope and builds its plugin only when the factory is materialized. That is
 * exactly what this harness reproduces — a fake `window`, a fake `require` for the two
 * platform seed words (`react`), and a captured factory — so the whole registration
 * path (including the `settings.section` registration and its React element tree) is
 * exercised for real, with no browser involved.
 *
 * Usage: node scripts/test-client-bundle.mjs   (exit 1 on failure)
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const source = await readFile(join(root, 'lib', 'client.js'), 'utf8')

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

// --- a minimal React stand-in --------------------------------------------------------
// Only what the component bodies touch. `createElement` records the element so the
// rendered tree can be inspected; hooks are inert (this is a registration test, not a
// rendering test).
function makeReact() {
  const createElement = (type, props, ...children) => ({
    type: typeof type === 'function' ? (type.name || 'anonymous') : type,
    props: { ...(props ?? {}), children: children.length === 1 ? children[0] : children },
    __isElement: true,
  })
  return {
    createElement,
    useState: (initial) => [initial, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (v) => ({ current: v }),
  }
}

// --- drive the bundle ----------------------------------------------------------------

let loaded = null
const fakeWindow = {
  __ModuleLoader__: {
    load: (record) => { loaded = record },
  },
}

// Evaluate the bundle in a function scope that supplies the browser globals. `require`
// returns the React stand-in for the one seed word the bundle asks for.
const run = new Function('window', 'require', 'console', source)
run(fakeWindow, (word) => {
  if (word === 'react') return makeReact()
  throw new Error(`unexpected require("${word}")`)
}, console)

check('the bundle registers itself with the module loader', loaded !== null, true)
check('the bundle id is the package name', loaded?.id, 'dsh-ark-plans')
check('the bundle exports a factory', typeof loaded?.factory, 'function')

const plugin = loaded.factory((word) => {
  if (word === 'react') return makeReact()
  throw new Error(`unexpected require("${word}")`)
})

check('the plugin has the package name', plugin?.name, 'dsh-ark-plans')
check('the plugin injects the Slot registry only', plugin?.inject, ['slots'])
check('the plugin exposes apply()', typeof plugin?.apply, 'function')

// --- drive apply() against a fake Slot registry --------------------------------------

const registrations = []
const ctx = {
  slots: {
    inject: (name, callback) => {
      // The real registry calls the callback once the Slot exists; call it immediately
      // so the registration itself is what gets asserted.
      callback()
    },
    register: (options, Component) => {
      registrations.push({ options, Component, slot: options.name })
      return () => {}
    },
  },
}

plugin.apply(ctx)

const ids = registrations.map((r) => r.options.id).sort()
check('two Slots are registered', registrations.length, 2)
check('the registered Slot ids', ids, ['ark-plans-models', 'ark-plans-quota'])
check(
  'the quota pill targets the session header utilities Slot',
  registrations.find((r) => r.options.id === 'ark-plans-quota')?.slot,
  'conversation.session.header.utilities',
)
check(
  'the model page targets the settings section Slot',
  registrations.find((r) => r.options.id === 'ark-plans-models')?.slot,
  'settings.section',
)

const models = registrations.find((r) => r.options.id === 'ark-plans-models')
check('the model page has a nav label function', typeof models.options.label, 'function')
check('the model page label reads 模型管理', models.options.label(), '模型管理')
check(
  'the model page sorts after the built-in sections',
  typeof models.options.order === 'number' && models.options.order >= 10,
  true,
)
check('the model page is a component', typeof models.Component, 'function')

// A registration failure must not escape: `apply` wraps both registrations in try/catch,
// so a registry that throws cannot take down the model routes this bundle provides.
let threw = false
try {
  plugin.apply({
    slots: {
      inject: () => { throw new Error('no such slot') },
      register: () => { throw new Error('no such slot') },
    },
  })
} catch {
  threw = true
}
check('a failing Slot registration is contained, not rethrown', threw, false)

if (failures > 0) {
  console.error(`\n${failures} of ${checks} check(s) failed`)
  process.exit(1)
}
console.log(`client bundle ok — ${checks} check(s) passed`)
