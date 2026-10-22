const OVERLAY_ID = 'office-markmap-overlay'
const MENU_CURRENT = 'vditor-menu--current'
const WIKI_LINK_RE = /!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g

const isProUser = () => document.body.classList.contains('is-pro')

const getMarkmapButton = () =>
    document.querySelector('.vditor-toolbar [data-type="markmap"]')

const setMarkmapButtonActive = (active) => {
    const btn = getMarkmapButton()
    if (!btn) return
    btn.classList.toggle(MENU_CURRENT, !!active)
}

const isMarkmapOpen = () => {
    const overlay = document.getElementById(OVERLAY_ID)
    return !!overlay && !overlay.hidden
}

const loadScript = (src, id) => new Promise((resolve, reject) => {
    if (document.getElementById(id)) {
        resolve()
        return
    }
    const existing = document.querySelector(`script[src="${src}"]`)
    if (existing) {
        if (existing.dataset.loaded === '1') {
            resolve()
            return
        }
        existing.addEventListener('load', () => resolve(), { once: true })
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true })
        return
    }
    const script = document.createElement('script')
    script.id = id
    script.src = src
    script.async = false
    script.onload = () => {
        script.dataset.loaded = '1'
        resolve()
    }
    script.onerror = () => reject(new Error(`Failed to load ${src}`))
    document.head.appendChild(script)
})

const ensureMarkmapScripts = async (cdn) => {
    const base = cdn.replace(/\/$/, '')
    await loadScript(`${base}/dist/js/markmap/d3.min.js`, 'officeMarkmapD3')
    if (!window.d3 && globalThis.d3) {
        window.d3 = globalThis.d3
    }
    await loadScript(`${base}/dist/js/katex/katex.min.js`, 'vditorKatexScript')
    await loadScript(`${base}/dist/js/highlightjs/highlight.min.js`, 'glassHighlightScript')
    await loadScript(`${base}/dist/js/markmap/markmap-lib.min.js`, 'officeMarkmapLib')
    await loadScript(`${base}/dist/js/markmap/markmap-view.min.js`, 'officeMarkmapView')
    if (!window.markmap?.Transformer || !window.markmap?.Markmap) {
        throw new Error('Markmap library failed to initialize')
    }
}

const syncOverlayPosition = (overlay) => {
    const host = overlay.parentElement
    const toolbar = host?.querySelector?.('.vditor-toolbar') || document.querySelector('.vditor-toolbar')
    if (host && getComputedStyle(host).position === 'static') {
        host.style.position = 'relative'
    }
    const top = toolbar ? Math.ceil(toolbar.offsetTop + toolbar.offsetHeight) : 0
    overlay.style.top = `${top}px`
}

const buildOverlay = () => {
    let overlay = document.getElementById(OVERLAY_ID)
    if (overlay) return overlay

    overlay = document.createElement('div')
    overlay.id = OVERLAY_ID
    overlay.className = 'office-markmap-overlay'
    overlay.hidden = true
    overlay.innerHTML = `
      <div class="office-markmap-panel" role="region" aria-label="Markmap">
        <div class="office-markmap-actions">
          <div class="office-markmap-mode" hidden>
            <button type="button" class="office-markmap-mode-btn is-active" data-markmap-action="mode-outline">Outline</button>
            <button type="button" class="office-markmap-mode-btn" data-markmap-action="mode-graph">Graph</button>
          </div>
          <button type="button" class="office-markmap-btn vditor-tooltipped vditor-tooltipped__s office-markmap-outline-only" data-markmap-action="collapse-1" aria-label="Collapse to level 1">
            <span class="codicon codicon-collapse-all" aria-hidden="true"></span>
          </button>
          <button type="button" class="office-markmap-btn vditor-tooltipped vditor-tooltipped__s office-markmap-outline-only" data-markmap-action="expand-all" aria-label="Expand all">
            <span class="codicon codicon-expand-all" aria-hidden="true"></span>
          </button>
          <div class="office-markmap-actions__divider" aria-hidden="true"></div>
          <button type="button" class="office-markmap-btn vditor-tooltipped vditor-tooltipped__s" data-markmap-action="zoom-out" aria-label="Zoom out">
            <span class="codicon codicon-zoom-out" aria-hidden="true"></span>
          </button>
          <button type="button" class="office-markmap-btn vditor-tooltipped vditor-tooltipped__s" data-markmap-action="zoom-in" aria-label="Zoom in">
            <span class="codicon codicon-zoom-in" aria-hidden="true"></span>
          </button>
          <button type="button" class="office-markmap-btn vditor-tooltipped vditor-tooltipped__s" data-markmap-action="fit" aria-label="Fit">
            <span class="codicon codicon-screen-full" aria-hidden="true"></span>
          </button>
          <div class="office-markmap-actions__divider" aria-hidden="true"></div>
          <button type="button" class="office-markmap-btn vditor-tooltipped vditor-tooltipped__s" data-markmap-action="refresh" aria-label="Refresh from editor">
            <span class="codicon codicon-refresh" aria-hidden="true"></span>
          </button>
          <button type="button" class="office-markmap-btn vditor-tooltipped vditor-tooltipped__s" data-markmap-action="export-svg" aria-label="Export SVG">
            <span class="codicon codicon-arrow-down" aria-hidden="true"></span>
          </button>
          <div class="office-markmap-actions__divider" aria-hidden="true"></div>
          <button type="button" class="office-markmap-btn office-markmap-btn--close vditor-tooltipped vditor-tooltipped__s" data-markmap-action="close" aria-label="Close Markmap">
            <span class="codicon codicon-close" aria-hidden="true"></span>
          </button>
        </div>
        <div class="office-markmap-body">
          <svg class="office-markmap-svg"></svg>
          <div class="office-markmap-lock" hidden>
            <button type="button" class="office-markmap-lock__card" data-markmap-action="upgrade">
              <span class="vditor-pro-locked__badge" aria-hidden="true">PRO</span>
              <span class="office-markmap-lock__text">Upgrade to Pro for interactive Markmap</span>
            </button>
          </div>
          <div class="office-markmap-status" hidden></div>
        </div>
      </div>
    `
    const host = document.getElementById('vditor') || document.querySelector('.vditor') || document.body
    host.appendChild(overlay)
    return overlay
}

const resolveEditorTextColor = () => {
    const source = document.querySelector('.vditor') || document.body
    const cs = getComputedStyle(source)
    return (
        cs.getPropertyValue('--textarea-text-color').trim()
        || cs.getPropertyValue('--front-color').trim()
        || cs.color
        || '#333'
    )
}

const resolveEditorSurfaceColor = () => {
    const source = document.querySelector('.vditor') || document.body
    const cs = getComputedStyle(source)
    return (
        cs.getPropertyValue('--panel-background-color').trim()
        || cs.getPropertyValue('--textarea-background-color').trim()
        || cs.getPropertyValue('--bg-color').trim()
        || '#fff'
    )
}

const resolveAccentColor = () => {
    const source = document.querySelector('.vditor') || document.body
    const cs = getComputedStyle(source)
    return (
        cs.getPropertyValue('--list-hover-color').trim()
        || cs.getPropertyValue('--link-color').trim()
        || '#4285f4'
    )
}

const applyMarkmapThemeColors = (svg) => {
    if (!svg) return
    const textColor = resolveEditorTextColor()
    svg.style.setProperty('--markmap-text-color', textColor)
    svg.style.setProperty('--markmap-code-color', textColor)
    svg.style.setProperty('--markmap-circle-open-bg', resolveEditorSurfaceColor())
    svg.style.color = textColor
}

const stripHtml = (html) => {
    if (!html) return ''
    const tmp = document.createElement('div')
    tmp.innerHTML = html
    return (tmp.textContent || tmp.innerText || '').trim()
}

const walkTree = (node, visitor, depth = 0) => {
    if (!node) return
    visitor(node, depth)
    const children = node.children || []
    for (let i = 0; i < children.length; i++) {
        walkTree(children[i], visitor, depth + 1)
    }
}

const setExpandLevel = (root, maxDepth) => {
    walkTree(root, (node, depth) => {
        node.payload = {
            ...(node.payload || {}),
            fold: maxDepth >= 0 && depth >= maxDepth ? 1 : 0,
        }
    })
}

const normalizeWikiPage = (page) =>
    String(page || '').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '').trim()

const wikiPageLabel = (page) => {
    const normalized = normalizeWikiPage(page)
    const slash = normalized.lastIndexOf('/')
    return slash >= 0 ? normalized.slice(slash + 1) : normalized
}

const extractOutboundWikiPages = (markdown) => {
    const pages = new Set()
    const re = new RegExp(WIKI_LINK_RE.source, 'g')
    let match
    while ((match = re.exec(markdown || '')) !== null) {
        const page = normalizeWikiPage(match[1])
        if (!page || page.startsWith('#')) continue
        pages.add(page)
    }
    return [...pages]
}

const getCurrentFileName = () =>
    window.__officeMarkdownFileName || document.title || 'Note'

const requestWikiGraph = (markdown) => {
    handler.emit('queryWikiGraph', { markdown })
}

let activeMm = null
let activeRoot = null
let activeEditor = null
let activeViewMode = 'outline' // outline | graph
let activeWikiGraph = null
let wikiGraphLoadToken = 0
let graphSimulation = null
let graphZoom = null
let graphSvgSel = null
let graphTransform = { k: 1, x: 0, y: 0 }
let resizeHandler = null

const setStatus = (overlay, message) => {
    const status = overlay.querySelector('.office-markmap-status')
    if (!status) return
    if (!message) {
        status.hidden = true
        status.textContent = ''
        return
    }
    status.hidden = false
    status.textContent = message
}

const requirePro = (editor) => {
    if (isProUser()) return true
    editor?.vditor?.options?.onRequirePro?.('markmap')
    return false
}

const applyMarkmapInteraction = (enabled) => {
    activeMm?.setOptions?.({
        zoom: !!enabled,
        pan: !!enabled,
    })
}

const syncProLock = (overlay) => {
    const lock = overlay.querySelector('.office-markmap-lock')
    const pro = isProUser()
    if (lock) lock.hidden = pro
    applyMarkmapInteraction(pro)
}

const destroyGraph = () => {
    graphSimulation?.stop?.()
    graphSimulation = null
    graphZoom = null
    graphSvgSel = null
    graphTransform = { k: 1, x: 0, y: 0 }
}

const destroyOutline = () => {
    activeMm?.destroy?.()
    activeMm = null
    activeRoot = null
}

export const closeMarkmapView = () => {
    const overlay = document.getElementById(OVERLAY_ID)
    if (overlay) overlay.hidden = true
    destroyOutline()
    destroyGraph()
    wikiGraphLoadToken += 1
    activeWikiGraph = null
    activeViewMode = 'outline'
    setMarkmapButtonActive(false)
    if (resizeHandler) {
        window.removeEventListener('resize', resizeHandler)
        resizeHandler = null
    }
}

const buildMarkmapStyle = (textColor) => (id) => `
${id} {
  --markmap-text-color: ${textColor} !important;
  --markmap-code-color: ${textColor} !important;
  color: ${textColor} !important;
}
${id} .markmap-foreign,
${id} .markmap-foreign * {
  color: ${textColor} !important;
}
${id} .markmap-foreign {
  cursor: pointer;
  transition: opacity 0.12s ease, filter 0.12s ease;
}
${id} .markmap-foreign:hover,
${id} .markmap-foreign:hover * {
  opacity: 0.72;
  filter: brightness(1.25);
}
`

const updateModeUi = (overlay) => {
    const hasGraph = !!(activeWikiGraph?.outbound?.length || activeWikiGraph?.inbound?.length)
    const modeBar = overlay.querySelector('.office-markmap-mode')
    if (modeBar) modeBar.hidden = !hasGraph

    const outlineBtns = overlay.querySelectorAll('[data-markmap-action="mode-outline"]')
    const graphBtns = overlay.querySelectorAll('[data-markmap-action="mode-graph"]')
    for (const btn of outlineBtns) {
        btn.classList.toggle('is-active', activeViewMode === 'outline')
    }
    for (const btn of graphBtns) {
        btn.classList.toggle('is-active', activeViewMode === 'graph')
    }

    const outlineOnly = overlay.querySelectorAll('.office-markmap-outline-only')
    for (const el of outlineOnly) {
        el.hidden = activeViewMode === 'graph'
    }

    overlay.classList.toggle('is-graph-mode', activeViewMode === 'graph')
}

const renderMarkmap = (overlay, markdown) => {
    const svg = overlay.querySelector('.office-markmap-svg')
    if (!svg) return
    destroyGraph()
    const { Transformer, Markmap } = window.markmap
    const transformer = new Transformer()
    const { root } = transformer.transform(markdown || '#')
    const pro = isProUser()
    const textColor = resolveEditorTextColor()
    destroyOutline()
    svg.replaceChildren()
    svg.classList.remove('office-markmap-svg--graph')
    activeRoot = root
    activeMm = Markmap.create(svg, {
        autoFit: true,
        duration: 300,
        maxWidth: 320,
        zoom: pro,
        pan: pro,
        style: buildMarkmapStyle(textColor),
    }, root)
    applyMarkmapThemeColors(svg)
    requestAnimationFrame(() => {
        applyMarkmapThemeColors(svg)
        activeMm?.fit?.()
    })
}

const buildGraphModel = (graph) => {
    const current = graph?.current || getCurrentFileName()
    const outbound = Array.isArray(graph?.outbound) ? graph.outbound : []
    const inbound = Array.isArray(graph?.inbound) ? graph.inbound : []
    const nodeMap = new Map()

    const upsert = (page, role) => {
        const id = wikiPageLabel(page) || page
        const existing = nodeMap.get(id)
        if (!existing) {
            nodeMap.set(id, { id, page, role, label: id })
            return
        }
        if (role === 'current') existing.role = 'current'
        else if (existing.role !== 'current' && existing.role !== role) existing.role = 'both'
        if (!existing.page || existing.page === existing.id) existing.page = page
    }

    upsert(current, 'current')
    for (const page of outbound) upsert(page, 'out')
    for (const page of inbound) upsert(page, 'in')

    const nodes = [...nodeMap.values()]
    const links = []
    const seen = new Set()
    const pushLink = (sourcePage, targetPage) => {
        const source = wikiPageLabel(sourcePage) || sourcePage
        const target = wikiPageLabel(targetPage) || targetPage
        if (!source || !target || source === target) return
        const key = `${source}->${target}`
        if (seen.has(key)) return
        seen.add(key)
        links.push({ source, target })
    }

    for (const page of outbound) pushLink(current, page)
    for (const page of inbound) pushLink(page, current)

    return { nodes, links, current }
}

const fitGraphView = (overlay, animate = true) => {
    if (!graphSvgSel || !window.d3 || !graphZoom) return
    const svgEl = overlay.querySelector('.office-markmap-svg')
    const g = svgEl?.querySelector('.office-wiki-graph')
    if (!svgEl || !g) return
    const width = svgEl.clientWidth || 800
    const height = svgEl.clientHeight || 600
    const bbox = g.getBBox()
    if (!bbox.width || !bbox.height) return
    const pad = 48
    const scale = Math.min(
        2.2,
        Math.max(0.25, Math.min((width - pad * 2) / bbox.width, (height - pad * 2) / bbox.height)),
    )
    const tx = width / 2 - (bbox.x + bbox.width / 2) * scale
    const ty = height / 2 - (bbox.y + bbox.height / 2) * scale
    const transform = window.d3.zoomIdentity.translate(tx, ty).scale(scale)
    graphSvgSel.transition().duration(animate ? 280 : 0).call(graphZoom.transform, transform)
    graphTransform = { k: scale, x: tx, y: ty }
}

const rescaleGraph = (factor) => {
    if (!graphSvgSel || !graphZoom || !window.d3) return
    graphSvgSel.transition().duration(160).call(graphZoom.scaleBy, factor)
}

const openWikiNode = (page) => {
    if (!page) return
    handler.emit('openLink', `wiki:${page}`)
}

const renderWikiGraph = (overlay, graph) => {
    const d3 = window.d3
    const svgEl = overlay.querySelector('.office-markmap-svg')
    if (!d3 || !svgEl) return

    destroyOutline()
    destroyGraph()
    svgEl.replaceChildren()
    svgEl.classList.add('office-markmap-svg--graph')

    const model = buildGraphModel(graph)
    const textColor = resolveEditorTextColor()
    const accent = resolveAccentColor()
    const surface = resolveEditorSurfaceColor()
    const width = svgEl.clientWidth || 800
    const height = svgEl.clientHeight || 600
    const pro = isProUser()

    const svg = d3.select(svgEl)
    const root = svg.append('g').attr('class', 'office-wiki-graph')

    graphZoom = d3.zoom()
        .scaleExtent([0.2, 4])
        .filter((event) => {
            if (!pro) return false
            if (event.type === 'wheel') return true
            if (event.button !== 0) return false
            const target = event.target
            return !(target?.closest?.('.office-wiki-graph__node'))
        })
        .on('zoom', (event) => {
            graphTransform = event.transform
            root.attr('transform', event.transform)
        })
    svg.call(graphZoom)
    graphSvgSel = svg

    const link = root.append('g')
        .attr('class', 'office-wiki-graph__links')
        .attr('stroke', textColor)
        .attr('stroke-opacity', 0.28)
        .selectAll('line')
        .data(model.links)
        .join('line')
        .attr('stroke-width', 1.2)

    const node = root.append('g')
        .attr('class', 'office-wiki-graph__nodes')
        .selectAll('g')
        .data(model.nodes)
        .join('g')
        .attr('class', (d) => `office-wiki-graph__node is-${d.role}`)
        .style('cursor', (d) => (d.role === 'current' ? 'default' : 'pointer'))

    const nodeFill = (d) => {
        if (d.role === 'current') return accent
        if (d.role === 'in') return '#34c759'
        if (d.role === 'both') return '#ff9f0a'
        return '#5ac8fa'
    }

    node.append('circle')
        .attr('r', (d) => (d.role === 'current' ? 18 : 11))
        .attr('fill', nodeFill)
        .attr('fill-opacity', (d) => (d.role === 'current' ? 1 : 0.88))
        .attr('stroke', surface)
        .attr('stroke-width', 2)
    node.append('text')
        .text((d) => d.label)
        .attr('x', 0)
        .attr('y', (d) => (d.role === 'current' ? 34 : 26))
        .attr('text-anchor', 'middle')
        .attr('fill', textColor)
        .attr('font-size', (d) => (d.role === 'current' ? 13 : 12))
        .attr('font-weight', (d) => (d.role === 'current' ? 600 : 400))

    if (pro) {
        node.call(d3.drag()
            .on('start', (event, d) => {
                if (!event.active) graphSimulation?.alphaTarget(0.25).restart()
                d.fx = d.x
                d.fy = d.y
            })
            .on('drag', (event, d) => {
                d.fx = event.x
                d.fy = event.y
            })
            .on('end', (event, d) => {
                if (!event.active) graphSimulation?.alphaTarget(0)
                d.fx = null
                d.fy = null
            }))
    }

    node.on('click', (event, d) => {
        event.stopPropagation()
        if (!requirePro(activeEditor)) return
        if (d.role === 'current') return
        openWikiNode(d.page || d.id)
    })

    graphSimulation = d3.forceSimulation(model.nodes)
        .force('link', d3.forceLink(model.links).id((d) => d.id).distance(110).strength(0.7))
        .force('charge', d3.forceManyBody().strength(-320))
        .force('center', d3.forceCenter(width / 2, height / 2))
        .force('collision', d3.forceCollide().radius((d) => (d.role === 'current' ? 42 : 28)))
        .on('tick', () => {
            link
                .attr('x1', (d) => d.source.x)
                .attr('y1', (d) => d.source.y)
                .attr('x2', (d) => d.target.x)
                .attr('y2', (d) => d.target.y)
            node.attr('transform', (d) => `translate(${d.x},${d.y})`)
        })
        .on('end', () => {
            fitGraphView(overlay, true)
        })

    // Seed center node near middle for faster settle
    const center = model.nodes.find((n) => n.role === 'current')
    if (center) {
        center.x = width / 2
        center.y = height / 2
        center.fx = width / 2
        center.fy = height / 2
        setTimeout(() => {
            if (center) {
                center.fx = null
                center.fy = null
            }
        }, 600)
    }
}

const renderActiveView = (overlay, markdown) => {
    if (activeViewMode === 'graph' && activeWikiGraph) {
        renderWikiGraph(overlay, activeWikiGraph)
    } else {
        activeViewMode = 'outline'
        renderMarkmap(overlay, markdown)
    }
    updateModeUi(overlay)
    syncProLock(overlay)
}

const normalizeWikiGraph = (data, outboundFallback) => {
    const graph = data && typeof data === 'object'
        ? data
        : { current: getCurrentFileName(), outbound: [], inbound: [] }
    const outbound = Array.isArray(graph.outbound) && graph.outbound.length
        ? graph.outbound
        : (outboundFallback || [])
    const inbound = Array.isArray(graph.inbound) ? graph.inbound : []
    return {
        current: graph.current || getCurrentFileName(),
        outbound,
        inbound,
    }
}

const applyWikiGraphData = (overlay, data, outboundFallback) => {
    const next = normalizeWikiGraph(data, outboundFallback)
    const prev = activeWikiGraph
    if (
        prev
        && prev.current === next.current
        && prev.outbound.join('\0') === next.outbound.join('\0')
        && prev.inbound.join('\0') === next.inbound.join('\0')
    ) {
        updateModeUi(overlay)
        return
    }

    activeWikiGraph = next
    if (!(activeWikiGraph.outbound.length || activeWikiGraph.inbound.length)) {
        activeWikiGraph = null
        if (activeViewMode === 'graph') {
            activeViewMode = 'outline'
            const markdown = typeof activeEditor?.getValue === 'function' ? activeEditor.getValue() : ''
            renderMarkmap(overlay, markdown)
        }
    } else if (activeViewMode === 'graph') {
        renderWikiGraph(overlay, activeWikiGraph)
    }
    updateModeUi(overlay)
    syncProLock(overlay)
}

const scheduleWikiGraphLoad = (overlay, markdown) => {
    const outbound = extractOutboundWikiPages(markdown)
    wikiGraphLoadToken += 1
    const token = wikiGraphLoadToken

    if (!outbound.length) {
        activeWikiGraph = null
        if (activeViewMode === 'graph') {
            activeViewMode = 'outline'
            renderMarkmap(overlay, markdown)
        }
        updateModeUi(overlay)
        return
    }

    // Instant local outbound — Graph tab ready without waiting for backlinks
    activeWikiGraph = {
        current: getCurrentFileName(),
        outbound,
        inbound: [],
    }
    updateModeUi(overlay)

    handler.on('wikiGraph', (data) => {
        if (token !== wikiGraphLoadToken || !isMarkmapOpen()) return
        applyWikiGraphData(overlay, data, outbound)
    })
    requestWikiGraph(markdown)
}

const refreshFromEditor = (overlay, editor) => {
    const markdown = typeof editor?.getValue === 'function' ? editor.getValue() : ''
    renderActiveView(overlay, markdown)
    scheduleWikiGraphLoad(overlay, markdown)
}

const applyExpandLevel = async (level, overlay) => {
    if (!activeMm || !activeRoot) return
    setExpandLevel(activeRoot, level)
    await activeMm.setData(activeRoot)
    applyMarkmapThemeColors(overlay?.querySelector('.office-markmap-svg') || document.querySelector('.office-markmap-svg'))
    await activeMm.fit?.()
}

const jumpToNodeInEditor = (editor, node) => {
    const text = stripHtml(node?.content)
    if (!text || !editor?.scrollToBlock) return false
    const ok = editor.scrollToBlock(text)
    if (ok) {
        closeMarkmapView()
        return true
    }
    const slug = text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')
    if (slug && editor.scrollToBlock(slug)) {
        closeMarkmapView()
        return true
    }
    return false
}

const formatCssForExport = (css) => {
    const normalized = String(css || '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .trim()
    if (!normalized) return ''

    const blocks = []
    const re = /([^{}]+)\{([^{}]*)\}/g
    let match
    while ((match = re.exec(normalized)) !== null) {
        const selectors = match[1]
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .join(',\n')
        const decls = match[2]
            .split(';')
            .map((d) => d.trim())
            .filter(Boolean)
            .map((d) => `  ${d};`)
            .join('\n')
        if (!selectors) continue
        blocks.push(decls ? `${selectors} {\n${decls}\n}` : `${selectors} {}`)
    }
    if (!blocks.length) return normalized
    return blocks.join('\n\n')
}

const prettyPrintSvgMarkup = (xml) => {
    const placeholders = []
    const stash = (tag, attrs, body) => {
        const key = `__OFFICE_SVG_PH_${placeholders.length}__`
        placeholders.push({ tag, attrs: attrs || '', body: body || '', key })
        return `<${tag}${attrs}>${key}</${tag}>`
    }

    let working = String(xml || '')
        .replace(/<\?xml[^?]*\?>\s*/i, '')
        .replace(/<!DOCTYPE[^>]*>\s*/i, '')
        .replace(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/gi, (_, attrs, body) => stash('style', attrs || '', body))
        .replace(/<foreignObject(\s[^>]*)?>([\s\S]*?)<\/foreignObject>/gi, (_, attrs, body) => stash('foreignObject', attrs || '', body))
        .replace(/>\s*</g, '>\n<')

    const lines = working.split('\n').map((l) => l.trim()).filter(Boolean)
    const out = []
    let depth = 0
    for (const line of lines) {
        const isClosing = /^<\//.test(line)
        const isSelfClosing = /\/>$/.test(line) || /^<\?/.test(line) || /^<!/.test(line)
        const isOpening = /^<[A-Za-z][^>]*>$/.test(line) && !isSelfClosing && !isClosing
        if (isClosing) depth = Math.max(0, depth - 1)
        out.push(`${'  '.repeat(depth)}${line}`)
        if (isOpening) depth += 1
    }

    let pretty = out.join('\n')
    for (const item of placeholders) {
        const needle = `<${item.tag}${item.attrs}>${item.key}</${item.tag}>`
        if (item.tag.toLowerCase() === 'style') {
            const css = formatCssForExport(item.body)
            const lines = [`<style${item.attrs}>`]
            if (css) {
                for (const cssLine of css.split('\n')) {
                    lines.push(cssLine ? `  ${cssLine}` : '')
                }
            }
            lines.push('</style>')
            pretty = pretty.replace(
                new RegExp(`^[ \\t]*${needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
                lines.join('\n'),
            )
            continue
        }
        const inner = item.body.replace(/\s+/g, ' ').trim()
        pretty = pretty.split(needle).join(`<${item.tag}${item.attrs}>${inner}</${item.tag}>`)
    }

    pretty = pretty.replace(/\t/g, '  ')
    return `<?xml version="1.0" encoding="UTF-8"?>\n${pretty}\n`
}

const exportSvg = (overlay) => {
    const svg = overlay.querySelector('.office-markmap-svg')
    if (!svg) return
    const clone = svg.cloneNode(true)
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink')
    clone.setAttribute('xmlns:xhtml', 'http://www.w3.org/1999/xhtml')

    const rect = svg.getBoundingClientRect()
    const width = Math.round(rect.width) || 1200
    const height = Math.round(rect.height) || 800
    if (!clone.getAttribute('width')) clone.setAttribute('width', String(width))
    if (!clone.getAttribute('height')) clone.setAttribute('height', String(height))
    if (!clone.getAttribute('viewBox')) clone.setAttribute('viewBox', `0 0 ${width} ${height}`)

    const styleNodes = clone.querySelectorAll('style')
    for (const styleEl of styleNodes) {
        styleEl.textContent = formatCssForExport(styleEl.textContent || '')
    }

    const raw = new XMLSerializer().serializeToString(clone)
    const content = prettyPrintSvgMarkup(raw)
    handler.emit('exportMarkmap', { content })
}

const setViewMode = (overlay, editor, mode) => {
    if (mode === 'graph' && !activeWikiGraph) return
    if (mode === activeViewMode) return
    activeViewMode = mode
    const markdown = typeof editor?.getValue === 'function' ? editor.getValue() : ''
    renderActiveView(overlay, markdown)
}

const bindOverlayOnce = (overlay, editor) => {
    if (overlay.dataset.bound === '1') {
        activeEditor = editor
        return
    }
    overlay.dataset.bound = '1'
    activeEditor = editor

    overlay.addEventListener('click', async (event) => {
        const actionEl = event.target.closest('[data-markmap-action]')
        if (actionEl) {
            const action = actionEl.dataset.markmapAction
            if (action === 'upgrade') {
                editor?.vditor?.options?.onRequirePro?.('markmap')
                return
            }
            if (action === 'close') {
                closeMarkmapView()
                return
            }
            if (action === 'mode-outline') {
                setViewMode(overlay, editor, 'outline')
                return
            }
            if (action === 'mode-graph') {
                setViewMode(overlay, editor, 'graph')
                return
            }
            if (!requirePro(editor)) return
            switch (action) {
                case 'fit':
                    if (activeViewMode === 'graph') fitGraphView(overlay, true)
                    else activeMm?.fit?.()
                    break
                case 'zoom-in':
                    if (activeViewMode === 'graph') rescaleGraph(1.25)
                    else activeMm?.rescale?.(1.25)
                    break
                case 'zoom-out':
                    if (activeViewMode === 'graph') rescaleGraph(0.8)
                    else activeMm?.rescale?.(0.8)
                    break
                case 'expand-all':
                    await applyExpandLevel(-1, overlay)
                    break
                case 'collapse-1':
                    await applyExpandLevel(1, overlay)
                    break
                case 'refresh':
                    await refreshFromEditor(overlay, editor)
                    break
                case 'export-svg':
                    exportSvg(overlay)
                    break
            }
            return
        }

        if (activeViewMode !== 'outline') return
        const foreign = event.target.closest('.markmap-foreign')
        if (!foreign) return
        if (!requirePro(editor)) return
        const text = (foreign.textContent || '').trim()
        if (!text || !activeRoot) return
        let target = null
        walkTree(activeRoot, (node) => {
            if (!target && stripHtml(node.content) === text) target = node
        })
        if (!target) {
            walkTree(activeRoot, (node) => {
                if (!target && stripHtml(node.content).includes(text)) target = node
            })
        }
        if (target) jumpToNodeInEditor(editor, target)
    })
}

const openMarkmapView = async (editor) => {
    const overlay = buildOverlay()
    bindOverlayOnce(overlay, editor)
    activeEditor = editor
    activeViewMode = 'outline'
    activeWikiGraph = null
    syncOverlayPosition(overlay)
    syncProLock(overlay)
    setStatus(overlay, 'Loading Markmap…')
    overlay.hidden = false
    setMarkmapButtonActive(true)

    if (!resizeHandler) {
        resizeHandler = () => {
            if (!isMarkmapOpen()) return
            syncOverlayPosition(overlay)
            if (activeViewMode === 'graph') fitGraphView(overlay, false)
            else activeMm?.fit?.()
        }
        window.addEventListener('resize', resizeHandler)
    }

    try {
        const cdn = editor?.vditor?.options?.cdn || ''
        await ensureMarkmapScripts(cdn)
        if (!isMarkmapOpen()) return
        const markdown = typeof editor?.getValue === 'function' ? editor.getValue() : ''
        renderActiveView(overlay, markdown)
        setStatus(overlay, '')
        syncProLock(overlay)
        scheduleWikiGraphLoad(overlay, markdown)
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatus(overlay, `Markmap render error: ${message}`)
    }
}

export const toggleMarkmapView = async (editor) => {
    if (isMarkmapOpen()) {
        closeMarkmapView()
        return
    }
    await openMarkmapView(editor)
}

export const refreshMarkmapProLock = () => {
    const overlay = document.getElementById(OVERLAY_ID)
    if (!overlay || overlay.hidden) return
    syncProLock(overlay)
}
