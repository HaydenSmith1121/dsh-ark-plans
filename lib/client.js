/**
 * dsh-ark-plans — client half.
 *
 * Renders the two plan lanes' allowance as one pill in the session header's utility
 * row, beside the shipped session controls. The pill starts compact — a bar per lane
 * with the percentage spent — and expands on click into the per-window detail the
 * host half fetched: used / total for each window and, for each, when it refreshes.
 *
 * Everything shown here arrives over the shared authenticated `/api` RPC channel as
 * plain JSON. The client never signs anything and never reads a credential: it asks
 * the host, and when the host cannot answer it shows the host's own explanation
 * (which names the remedy, such as re-running `arkcli auth login volc-sso`) rather
 * than an empty or wrong number.
 *
 * This file is a **factory-form CJS browser bundle**, not an ES module: the shell
 * registers it with `window.__ModuleLoader__.load({ id, factory })`, and the module
 * body runs when the factory is first materialized. `react` is a platform seed word,
 * which is why it is reached through `require` rather than an import.
 *
 * @module dsh-ark-plans/client
 */

window.__ModuleLoader__.load({
  // Must equal the package name: the boot graph addresses this bundle by it.
  id: 'dsh-ark-plans',
  factory: (require) => {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useState } = React

    /** The host half's one route, read same-origin. */
    const ROUTE = '/plugins/dsh-ark-plans/quota'

    /** The host half's model-management route, read and written same-origin. */
    const MODELS_ROUTE = '/plugins/dsh-ark-plans/models'

    /** How often the pill re-asks the host while the page is open. */
    const POLL_MS = 5 * 60_000

    /** Copy for the period labels the host reports. */
    const PERIOD_TEXT = {
      '5h': '5 小时',
      session: '会话',
      weekly: '本周',
      monthly: '本月',
    }

    /**
     * Format a count for a compact pill: thousands separators, and a `k`/`M` suffix
     * once the number stops being readable in full.
     *
     * @param value - the raw count, or `null` when the lane does not report it.
     * @returns the display string.
     */
    function formatCount(value) {
      if (value === null || value === undefined) return '—'
      if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
      if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`
      return String(value)
    }

    /**
     * Format a percentage for display.
     *
     * @param value - the percentage, or `null` when it cannot be derived.
     * @returns the display string.
     */
    function formatPercent(value) {
      if (value === null || value === undefined) return '—'
      const rounded = Math.round(value * 10) / 10
      return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`
    }

    /**
     * Describe how long until a reset, in the coarsest unit that is still useful.
     *
     * @param resetAt - the RFC3339 instant the window refreshes, or `null`.
     * @returns the relative description, or `null` when there is nothing to say.
     */
    function untilText(resetAt) {
      if (resetAt === null || resetAt === undefined) return null
      const at = Date.parse(resetAt)
      if (Number.isNaN(at)) return null
      const deltaMs = at - Date.now()
      if (deltaMs <= 0) return '即将刷新'
      const minutes = Math.round(deltaMs / 60_000)
      if (minutes < 60) return `${minutes} 分钟后`
      const hours = Math.round(minutes / 60)
      if (hours < 48) return `${hours} 小时后`
      return `${Math.round(hours / 24)} 天后`
    }

    /**
     * Render one instant in the reader's own timezone and locale.
     *
     * @param value - the RFC3339 instant, or `null`.
     * @returns the display string.
     */
    function formatInstant(value) {
      if (value === null || value === undefined) return '—'
      const at = Date.parse(value)
      if (Number.isNaN(at)) return '—'
      return new Date(at).toLocaleString()
    }

    /**
     * Choose a bar colour from how much of the window is spent.
     *
     * @param percent - the spent percentage, or `null`.
     * @returns a theme variable reference.
     */
    function barColor(percent) {
      if (percent === null || percent === undefined) return 'var(--dsw-alias-label-secondary)'
      if (percent >= 90) return 'var(--dsw-alias-state-error-primary)'
      if (percent >= 70) return 'var(--dsw-alias-state-warn-primary)'
      return 'var(--dsw-alias-brand-primary)'
    }

    /**
     * Pick the window the collapsed pill should lead with.
     *
     * The narrowest active window is the one a user can still act on — a monthly
     * allowance that looks healthy is irrelevant when the 5-hour window is exhausted
     * — so that is the one the collapsed pill leads with.
     *
     * @param periods - the lane's windows.
     * @returns the chosen window, or `undefined` when the lane reported none.
     */
    function pickPrimaryPeriod(periods) {
      if (!Array.isArray(periods) || periods.length === 0) return undefined
      for (const key of ['5h', 'session', 'weekly', 'monthly']) {
        const found = periods.find((p) => p.label === key)
        if (found !== undefined) return found
      }
      return periods[0]
    }

    /**
     * One lane's compact row: name, the window that matters most, and its bar.
     *
     * @param props - the lane snapshot from the host.
     */
    function LaneSummary({ plan }) {
      const ok = plan.status === 'ok'
      const primary = ok ? pickPrimaryPeriod(plan.periods) : undefined

      return h(
        'div',
        { style: { display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' } },
        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, plan.plan),
        ok && primary !== undefined
          ? h(
            'span',
            { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
            h(
              'span',
              {
                style: {
                  display: 'inline-block',
                  width: '48px',
                  height: '6px',
                  borderRadius: '3px',
                  background: 'var(--dsw-alias-bg-layer-2)',
                  overflow: 'hidden',
                },
              },
              h('span', {
                style: {
                  display: 'block',
                  height: '100%',
                  width: `${Math.max(0, Math.min(100, primary.percent ?? 0))}%`,
                  background: barColor(primary.percent),
                },
              }),
            ),
            h(
              'span',
              { style: { fontVariantNumeric: 'tabular-nums' } },
              formatPercent(primary.percent),
            ),
          )
          : h(
            'span',
            { style: { color: 'var(--dsw-alias-state-warn-primary)' } },
            ok ? '无数据' : '不可用',
          ),
      )
    }

    /**
     * One window's detail row inside the expanded panel.
     *
     * @param props - the period snapshot.
     */
    function PeriodRow({ period }) {
      const until = untilText(period.resetAt)
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
        h(
          'div',
          { style: { display: 'flex', justifyContent: 'space-between', gap: '12px' } },
          h('span', null, PERIOD_TEXT[period.label] ?? period.label),
          h(
            'span',
            { style: { fontVariantNumeric: 'tabular-nums' } },
            period.used !== null && period.total !== null
              ? `${formatCount(period.used)} / ${formatCount(period.total)}（${formatPercent(period.percent)}）`
              : formatPercent(period.percent),
          ),
        ),
        h(
          'div',
          {
            style: {
              display: 'flex',
              justifyContent: 'space-between',
              gap: '12px',
              color: 'var(--dsw-alias-label-secondary)',
              fontSize: '11px',
            },
          },
          h('span', null, period.resetAt !== null ? `刷新：${formatInstant(period.resetAt)}` : '刷新时间未知'),
          until !== null ? h('span', null, until) : null,
        ),
      )
    }

    /**
     * One lane's full block inside the expanded panel.
     *
     * @param props - the lane snapshot from the host.
     */
    function LaneDetail({ plan }) {
      const ok = plan.status === 'ok'
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h(
          'div',
          { style: { fontWeight: 600 } },
          plan.plan,
          plan.tier !== null && plan.tier !== undefined ? ` · ${plan.tier}` : '',
        ),
        ok
          ? plan.periods.map((period) => h(PeriodRow, { key: period.label, period }))
          : h(
            'div',
            { style: { color: 'var(--dsw-alias-state-warn-primary)', whiteSpace: 'normal' } },
            plan.reason ?? '额度不可用。',
          ),
      )
    }

    /**
     * The pill itself: collapsed summary, expanding to per-window detail.
     */
    function QuotaPill() {
      const [state, setState] = useState({ status: 'loading' })
      const [open, setOpen] = useState(false)

      const load = useCallback(async (force) => {
        try {
          // Same-origin, so the deployment's own auth cookie rides along and the host's
          // loopback fence is the only additional check it needs.
          const response = await fetch(force === true ? `${ROUTE}?force=1` : ROUTE, {
            credentials: 'same-origin',
            headers: { accept: 'application/json' },
          })
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          const result = await response.json().catch(() => undefined)
          if (result?.ok !== true) {
            setState({ status: 'error', error: result?.error ?? '未知错误' })
            return
          }
          setState({ status: 'ready', plans: result.plans ?? [], checkedAt: result.checkedAt })
        } catch (error) {
          setState({ status: 'error', error: String(error) })
        }
      }, [])

      useEffect(() => {
        void load(false)
        const id = setInterval(() => void load(false), POLL_MS)
        return () => clearInterval(id)
      }, [load])

      if (state.status === 'loading') {
        return h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, '方舟套餐 …')
      }
      if (state.status === 'error') {
        return h(
          'span',
          { style: { color: 'var(--dsw-alias-state-error-primary)' }, title: state.error },
          '方舟套餐 读取失败',
        )
      }

      const plans = state.plans
      const allOk = plans.every((plan) => plan.status === 'ok')

      return h(
        'div',
        { style: { position: 'relative' } },
        h(
          'button',
          {
            type: 'button',
            onClick: () => {
              setOpen((wasOpen) => {
                // Opening is also the natural moment to re-check, so the detail the
                // user is about to read is not the stale copy the polling loop holds.
                if (!wasOpen) void load(true)
                return !wasOpen
              })
            },
            title: allOk
              ? `火山方舟套餐额度 · 更新于 ${formatInstant(state.checkedAt)}`
              : '火山方舟套餐额度（部分车道不可用，点击查看原因）',
            style: {
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              padding: '2px 8px',
              borderRadius: '6px',
              border: '1px solid var(--dsw-alias-border-l1)',
              background: 'var(--dsw-alias-bg-layer-1)',
              color: 'var(--dsw-alias-label-primary)',
              fontSize: '12px',
              cursor: 'pointer',
              font: 'inherit',
            },
          },
          plans.map((plan) => h(LaneSummary, { key: plan.route, plan })),
        ),
        open
          ? h(
            'div',
            {
              style: {
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 40,
                minWidth: '300px',
                padding: '10px 12px',
                borderRadius: '8px',
                border: '1px solid var(--dsw-alias-border-l1)',
                background: 'var(--dsw-alias-bg-overlay)',
                color: 'var(--dsw-alias-label-primary)',
                boxShadow: '0 6px 20px rgba(0, 0, 0, 0.18)',
                display: 'flex',
                flexDirection: 'column',
                gap: '10px',
                fontSize: '12px',
                textAlign: 'left',
              },
            },
            plans.map((plan) => h(LaneDetail, { key: plan.route, plan })),
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '12px',
                  borderTop: '1px solid var(--dsw-alias-border-l1)',
                  paddingTop: '8px',
                  color: 'var(--dsw-alias-label-secondary)',
                  fontSize: '11px',
                },
              },
              h('span', null, `更新于 ${formatInstant(state.checkedAt)}`),
              h(
                'button',
                {
                  type: 'button',
                  onClick: () => void load(true),
                  style: {
                    border: 'none',
                    background: 'none',
                    color: 'var(--dsw-alias-brand-primary)',
                    cursor: 'pointer',
                    padding: 0,
                    font: 'inherit',
                  },
                },
                '刷新',
              ),
            ),
          )
          : null,
      )
    }

    /**
     * One lane's model list, with a toggle per model.
     *
     * The panel edits a local draft and writes it on an explicit save, rather than
     * writing on every click: each write persists `settings.yaml`, and a toggle-per-write
     * would rewrite the file once per click. The draft also means a failed write leaves
     * the user's selection on screen to retry, instead of silently reverting.
     *
     * @param props - the lane's catalog, its current selection, and the save handler.
     */
    function LaneModels({ plan, draft, onToggle, onSave, onReset, busy, error, saved }) {
      const enabled = new Set(draft ?? plan.enabled)
      const dirty = plan.models.some((m) => enabled.has(m.id) !== plan.enabled.includes(m.id))
      const count = plan.models.filter((m) => enabled.has(m.id)).length

      return h(
        'div',
        {
          style: {
            border: '1px solid var(--dsw-alias-border-secondary)',
            borderRadius: '10px',
            padding: '12px 14px',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px',
          },
        },
        h(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' } },
          h('strong', { style: { fontSize: '14px' } }, plan.plan),
          h(
            'span',
            { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } },
            `${count} / ${plan.models.length} 已启用`,
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '2px' } },
          ...plan.models.map((model) => h(
            'label',
            {
              key: model.id,
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '5px 0',
                cursor: busy ? 'default' : 'pointer',
              },
            },
            h('input', {
              type: 'checkbox',
              checked: enabled.has(model.id),
              disabled: busy,
              onChange: () => onToggle(plan.route, model.id),
            }),
            h('span', { style: { fontSize: '13px' } }, model.name),
            h(
              'code',
              { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '11px' } },
              model.id,
            ),
          )),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              disabled: busy || !dirty,
              onClick: () => onSave(plan.route),
              style: {
                padding: '5px 12px',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-secondary)',
                background: dirty ? 'var(--dsw-alias-brand-primary)' : 'transparent',
                color: dirty ? '#fff' : 'var(--dsw-alias-label-secondary)',
                cursor: busy || !dirty ? 'default' : 'pointer',
                fontSize: '12px',
              },
            },
            busy ? '保存中…' : '保存',
          ),
          h(
            'button',
            {
              type: 'button',
              disabled: busy,
              onClick: () => onReset(plan.route),
              style: {
                padding: '5px 12px',
                borderRadius: '6px',
                border: '1px solid var(--dsw-alias-border-secondary)',
                background: 'transparent',
                color: 'var(--dsw-alias-label-secondary)',
                cursor: busy ? 'default' : 'pointer',
                fontSize: '12px',
              },
            },
            '全选',
          ),
          error !== null && error !== undefined
            ? h('span', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: '12px' } }, error)
            : null,
          saved === true
            ? h('span', { style: { color: 'var(--dsw-alias-label-secondary)', fontSize: '12px' } }, '已保存')
            : null,
        ),
      )
    }

    /**
     * The Settings → 模型管理 page.
     *
     * Lists every model each Ark lane can serve and lets the user uncheck the ones they
     * do not want in the model selector. The catalog is the plugin's own; the selection
     * is persisted to `settings.yaml` and applied to `llm-pi-ai` live, so a save takes
     * effect in the selector without restarting the harness.
     *
     * @param props - the Slot's props (unused; the page reads the host itself).
     */
    function ModelsSection() {
      const [state, setState] = useState({ status: 'loading', plans: [], error: null })
      const [drafts, setDrafts] = useState({})
      const [busyRoute, setBusyRoute] = useState(null)
      const [errors, setErrors] = useState({})
      const [savedRoute, setSavedRoute] = useState(null)

      const load = useCallback(async () => {
        try {
          const res = await fetch(MODELS_ROUTE, { headers: { accept: 'application/json' } })
          const body = await res.json()
          if (body?.ok !== true) throw new Error(body?.error ?? '读取失败')
          setState({ status: 'ready', plans: body.plans ?? [], error: null })
          setDrafts({})
        } catch (error) {
          setState({ status: 'failed', plans: [], error: String(error?.message ?? error) })
        }
      }, [])

      useEffect(() => { void load() }, [load])

      const toggle = useCallback((route, id) => {
        setSavedRoute(null)
        setDrafts((prev) => {
          const plan = state.plans.find((p) => p.route === route)
          if (plan === undefined) return prev
          const current = new Set(prev[route] ?? plan.enabled)
          if (current.has(id)) current.delete(id)
          else current.add(id)
          return { ...prev, [route]: [...current] }
        })
      }, [state.plans])

      const save = useCallback(async (route) => {
        const enabled = drafts[route]
        if (enabled === undefined) return
        setBusyRoute(route)
        setErrors((prev) => ({ ...prev, [route]: null }))
        try {
          const res = await fetch(MODELS_ROUTE, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ route, enabled }),
          })
          const body = await res.json()
          if (body?.ok !== true) throw new Error(body?.error ?? '保存失败')
          setState({ status: 'ready', plans: body.plans ?? [], error: null })
          setDrafts((prev) => {
            const next = { ...prev }
            delete next[route]
            return next
          })
          setSavedRoute(route)
        } catch (error) {
          setErrors((prev) => ({ ...prev, [route]: String(error?.message ?? error) }))
        } finally {
          setBusyRoute(null)
        }
      }, [drafts])

      const reset = useCallback((route) => {
        const plan = state.plans.find((p) => p.route === route)
        if (plan === undefined) return
        setSavedRoute(null)
        setDrafts((prev) => ({ ...prev, [route]: plan.models.map((m) => m.id) }))
      }, [state.plans])

      if (state.status === 'loading') {
        return h('div', { style: { padding: '16px', color: 'var(--dsw-alias-label-secondary)' } }, '加载中…')
      }
      if (state.status === 'failed') {
        return h(
          'div',
          { style: { padding: '16px', color: 'var(--dsw-alias-state-error-primary)' } },
          `读取模型清单失败：${state.error}`,
        )
      }

      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '14px', padding: '4px 2px' } },
        h(
          'p',
          { style: { margin: 0, color: 'var(--dsw-alias-label-secondary)', fontSize: '12px', lineHeight: '1.7' } },
          '取消勾选即可把模型从「模型选择器」里隐藏，保存后立即生效，无需重启。',
          h('br'),
          '这里只控制本插件提供的两条火山方舟车道；Key 仍在「设置 → 模型」里填写。',
        ),
        ...state.plans.map((plan) => h(LaneModels, {
          key: plan.route,
          plan,
          draft: drafts[plan.route],
          onToggle: toggle,
          onSave: save,
          onReset: reset,
          busy: busyRoute === plan.route,
          error: errors[plan.route],
          saved: savedRoute === plan.route,
        })),
      )
    }

    /** The Cordis plugin name; identical to the package name. */
    const name = 'dsh-ark-plans'

    /** This half needs the Slot registry, and nothing else. */
    const inject = ['slots']

    /**
     * Mount the pill into the session header's utility row.
     *
     * The registration is contained: a Slot that never appears, or a registration the
     * owner rejects, must not take down the model routes this bundle exists to provide.
     *
     * @param ctx - the plugin's Cordis context.
     */
    function apply(ctx) {
      try {
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register(
          {
            name: 'conversation.session.header.utilities',
            id: 'ark-plans-quota',
            // After the shipped session controls, so the row still reads as the
            // session's own utilities first and the allowance second.
            order: 20,
          },
          QuotaPill,
        ))
      } catch (error) {
        console.error('[dsh-ark-plans] quota pill failed to load (model routing unaffected):', error)
      }

      // The model-management page. Contained like the pill: a Slot that never appears,
      // or a registration the owner rejects, must not take down the model routes.
      try {
        ctx.slots.inject('settings.section', () => ctx.slots.register(
          {
            name: 'settings.section',
            id: 'ark-plans-models',
            // After the shipped sections (general 0, models 10, …), so it lands at the
            // end of the nav rather than displacing a built-in entry.
            order: 90,
            label: () => '模型管理',
          },
          ModelsSection,
        ))
      } catch (error) {
        console.error('[dsh-ark-plans] model-management page failed to load (model routing unaffected):', error)
      }
    }

    return { name, inject, apply }
  },
})
