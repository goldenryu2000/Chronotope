import { Marker, type Map as MapLibreMap } from 'maplibre-gl'
import { presence, type ActiveEntity } from '../data/entitySpan'
import { formatYear } from '../lib/year'
import { layoutPins, type Cluster, type Placed } from './declutter'

// The ported build inlined its own BCE/CE formatter here; src/lib/year.ts now
// owns that, along with the reasoning about why years are plain signed integers.
function formatYears(start: number, end: number): string {
  return `${formatYear(start)} – ${formatYear(end)}`
}

/**
 * Draws entity pins as HTML markers and handles clusters with a smart zoom + popover model.
 */
export class EntityMarkers {
  private readonly pins = new Map<string, { marker: Marker; element: HTMLButtonElement }>()
  private readonly clusters = new Map<string, { marker: Marker; element: HTMLButtonElement }>()

  private popoverMarker: Marker | null = null
  private popoverElement: HTMLElement | null = null
  private activePopoverClusterId: string | null = null
  private activePopoverEntityIds = new Set<string>()

  private entities: readonly ActiveEntity[] = []
  private year = 0
  private selectedId: string | null = null
  private frame = 0

  constructor(
    private readonly map: MapLibreMap,
    private readonly onSelect: (id: string) => void,
  ) {
    this.map.on('zoom', this.scheduleRelayout)
  }

  update(visible: readonly ActiveEntity[], year: number, selectedId: string | null): void {
    this.entities = visible
    this.year = year
    this.selectedId = selectedId

    // Close popover if its cluster entities are no longer active in this year/pack
    if (
      this.activePopoverEntityIds.size > 0 &&
      !visible.some((entity) => this.activePopoverEntityIds.has(entity.id))
    ) {
      this.closePopover()
    } else if (this.popoverElement) {
      // Sync active state in open popover
      const items = this.popoverElement.querySelectorAll('.cluster-popover__item')
      for (const el of items) {
        const htmlEl = el as HTMLElement
        htmlEl.dataset.selected = String(htmlEl.dataset.entityId === selectedId)
      }
    }

    this.relayout()
  }

  /** Collapse any expanded popover — used when the map background is clicked. */
  collapse(): void {
    this.closePopover()
  }

  private closePopover(): void {
    if (this.popoverMarker) {
      this.popoverMarker.remove()
      this.popoverMarker = null
    }
    this.popoverElement = null
    this.activePopoverClusterId = null
    this.activePopoverEntityIds.clear()
  }

  private scheduleRelayout = () => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.relayout()
    })
  }

  private relayout(): void {
    const { placed, clusters } = layoutPins(
      this.entities,
      (entity) => this.map.project([entity.lng, entity.lat]),
    )

    this.syncPins(placed)
    this.syncClusters(clusters)
    this.syncPopover(clusters)
  }

  private syncPins(placed: Placed[]): void {
    const wanted = new Set(placed.map((item) => item.entity.id))

    for (const [id, entry] of this.pins) {
      if (!wanted.has(id)) {
        entry.marker.remove()
        this.pins.delete(id)
      }
    }

    for (const item of placed) {
      let entry = this.pins.get(item.entity.id)

      if (!entry) {
        const element = this.createPin(item.entity)
        const marker = new Marker({ element, anchor: 'center' })
          .setLngLat([item.entity.lng, item.entity.lat])
          .addTo(this.map)
        entry = { marker, element }
        this.pins.set(item.entity.id, entry)
      }

      const dx = item.at.x - item.anchor.x
      const dy = item.at.y - item.anchor.y
      entry.marker.setOffset([dx, dy])

      entry.element.style.setProperty('--leader', `${Math.round(Math.hypot(dx, dy))}px`)
      entry.element.style.setProperty('--leader-angle', `${Math.atan2(dy, dx) + Math.PI}rad`)
      entry.element.dataset.offset = String(item.offset)
      entry.element.dataset.label = item.label ? 'show' : 'hide'

      const selected = item.entity.id === this.selectedId
      entry.element.dataset.selected = String(selected)
      entry.element.style.opacity = selected ? '1' : String(presence(item.entity, this.year))
    }
  }

  private syncClusters(clusters: Cluster[]): void {
    const wanted = new Set(clusters.map((cluster) => cluster.id))

    for (const [id, entry] of this.clusters) {
      if (!wanted.has(id)) {
        entry.marker.remove()
        this.clusters.delete(id)
      }
    }

    for (const cluster of clusters) {
      let entry = this.clusters.get(cluster.id)

      if (!entry) {
        const element = document.createElement('button')
        element.type = 'button'
        element.className = 'cluster'
        element.innerHTML = `<span class="cluster__count">${cluster.members.length}</span>`

        element.addEventListener('click', (event) => {
          event.stopPropagation()
          const zoom = this.map.getZoom()
          const [minLng, minLat] = cluster.bounds[0]
          const [maxLng, maxLat] = cluster.bounds[1]
          const dLng = maxLng - minLng
          const dLat = maxLat - minLat

          // If members are spread out geographically and zoom is low, zoom into bounds
          if (zoom < 4.2 && (dLng > 0.4 || dLat > 0.4)) {
            this.map.fitBounds(cluster.bounds, {
              padding: 90,
              maxZoom: 5.2,
              duration: 600,
            })
            this.closePopover()
            return
          }

          // Otherwise, toggle the location popover card
          if (this.activePopoverClusterId === cluster.id) {
            this.closePopover()
          } else {
            this.openPopover(cluster)
          }
        })

        const marker = new Marker({ element, anchor: 'center' })
          .setLngLat(cluster.lngLat)
          .addTo(this.map)

        entry = { marker, element }
        this.clusters.set(cluster.id, entry)
      } else {
        entry.marker.setLngLat(cluster.lngLat)
        const countSpan = entry.element.querySelector('.cluster__count')
        if (countSpan) countSpan.textContent = String(cluster.members.length)
      }

      entry.element.setAttribute(
        'aria-label',
        `${cluster.members.length} entities in ${cluster.place}: ${cluster.members.map((m) => m.name).join(', ')}`,
      )
      entry.element.setAttribute(
        'title',
        `${cluster.place} (${cluster.members.length} entities)`,
      )
      entry.element.dataset.active = String(this.activePopoverClusterId === cluster.id)
    }
  }

  private syncPopover(clusters: Cluster[]): void {
    if (!this.activePopoverClusterId || this.activePopoverEntityIds.size === 0) return

    // Find cluster at current zoom sharing members with popover or holding selected entity
    const activeCluster = clusters.find(
      (c) =>
        c.members.some((m) => this.activePopoverEntityIds.has(m.id)) ||
        (this.selectedId && c.members.some((m) => m.id === this.selectedId)),
    )

    if (!activeCluster) {
      // Cluster separated into single pins; close popover
      this.closePopover()
      return
    }

    // Keep active cluster reference and marker position updated
    this.activePopoverClusterId = activeCluster.id
    this.activePopoverEntityIds = new Set(activeCluster.members.map((m) => m.id))
    this.popoverMarker?.setLngLat(activeCluster.lngLat)

    // Dynamically update list content & member count on zoom
    if (this.popoverElement) {
      this.updatePopoverDOM(activeCluster)
    }
  }

  private updatePopoverDOM(cluster: Cluster): void {
    if (!this.popoverElement) return

    const title = this.popoverElement.querySelector('.cluster-popover__title')
    if (title) title.textContent = cluster.place

    const countBadge = this.popoverElement.querySelector('.cluster-popover__count')
    if (countBadge) countBadge.textContent = `${cluster.members.length} entities`

    const list = this.popoverElement.querySelector('.cluster-popover__list')
    if (!list) return

    const existingItems = Array.from(list.children) as HTMLElement[]
    const existingMap = new Map<string, HTMLElement>()
    for (const item of existingItems) {
      if (item.dataset.entityId) existingMap.set(item.dataset.entityId, item)
    }

    const newEntityIds = new Set(cluster.members.map((m) => m.id))

    // Remove members that split out of cluster
    for (const [id, item] of existingMap.entries()) {
      if (!newEntityIds.has(id)) {
        item.remove()
      }
    }

    // Add or update members
    for (const entity of cluster.members) {
      let item = existingMap.get(entity.id)
      if (!item) {
        item = this.createPopoverItem(entity)
        list.append(item)
      }
      item.dataset.selected = String(entity.id === this.selectedId)
    }
  }

  private openPopover(cluster: Cluster): void {
    this.closePopover()

    const container = document.createElement('div')
    container.className = 'cluster-popover'
    container.setAttribute('role', 'dialog')
    container.setAttribute('aria-label', `Entities in ${cluster.place}`)

    container.addEventListener('click', (e) => e.stopPropagation())

    // Header
    const header = document.createElement('div')
    header.className = 'cluster-popover__header'

    const titleGroup = document.createElement('div')
    titleGroup.className = 'cluster-popover__title-group'

    const title = document.createElement('h3')
    title.className = 'cluster-popover__title'
    title.textContent = cluster.place

    const countBadge = document.createElement('span')
    countBadge.className = 'cluster-popover__count'
    countBadge.textContent = `${cluster.members.length} entities`

    titleGroup.append(title, countBadge)

    const closeBtn = document.createElement('button')
    closeBtn.type = 'button'
    closeBtn.className = 'cluster-popover__close'
    closeBtn.innerHTML = '&times;'
    closeBtn.setAttribute('aria-label', 'Close')
    closeBtn.addEventListener('click', () => this.closePopover())

    header.append(titleGroup, closeBtn)

    // List of entities
    const list = document.createElement('div')
    list.className = 'cluster-popover__list'

    for (const entity of cluster.members) {
      const item = this.createPopoverItem(entity)
      list.append(item)
    }

    container.append(header, list)

    this.popoverElement = container
    this.popoverMarker = new Marker({ element: container, anchor: 'bottom', offset: [0, -18] })
      .setLngLat(cluster.lngLat)
      .addTo(this.map)

    this.activePopoverClusterId = cluster.id
    this.activePopoverEntityIds = new Set(cluster.members.map((m) => m.id))
    this.relayout()
  }

  private createPopoverItem(entity: ActiveEntity): HTMLButtonElement {
    const item = document.createElement('button')
    item.type = 'button'
    item.className = 'cluster-popover__item'
    item.dataset.entityId = entity.id
    if (entity.id === this.selectedId) {
      item.dataset.selected = 'true'
    }

    const itemHeader = document.createElement('div')
    itemHeader.className = 'cluster-popover__item-header'

    const itemName = document.createElement('span')
    itemName.className = 'cluster-popover__item-name'
    itemName.textContent = entity.name

    const itemSpan = document.createElement('span')
    itemSpan.className = 'cluster-popover__item-span'
    itemSpan.textContent = formatYears(entity.start, entity.end)

    itemHeader.append(itemName, itemSpan)

    const itemBlurb = document.createElement('p')
    itemBlurb.className = 'cluster-popover__item-blurb'
    itemBlurb.textContent = entity.blurb

    item.append(itemHeader, itemBlurb)

    item.addEventListener('click', () => {
      this.onSelect(entity.id)
      if (this.popoverElement) {
        const items = this.popoverElement.querySelectorAll('.cluster-popover__item')
        for (const el of items) {
          const htmlEl = el as HTMLElement
          htmlEl.dataset.selected = String(htmlEl.dataset.entityId === entity.id)
        }
      }
    })

    return item
  }

  private createPin(entity: ActiveEntity): HTMLButtonElement {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = 'pin'
    element.dataset.fuzzy = String(Boolean(entity.fuzzy))
    element.setAttribute('aria-label', `${entity.name}, ${entity.place}`)

    const dot = document.createElement('span')
    dot.className = 'pin__dot'

    const label = document.createElement('span')
    label.className = 'pin__label'
    label.textContent = entity.name

    element.append(dot, label)

    element.addEventListener('click', (event) => {
      event.stopPropagation()
      this.onSelect(entity.id)
    })

    return element
  }

  destroy(): void {
    if (this.frame) cancelAnimationFrame(this.frame)
    this.map.off('zoom', this.scheduleRelayout)
    this.closePopover()
    for (const { marker } of this.pins.values()) marker.remove()
    for (const { marker } of this.clusters.values()) marker.remove()
    this.pins.clear()
    this.clusters.clear()
  }
}

