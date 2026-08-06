export type InventoryRecord = Record<string, unknown>
export type EquipmentProgress = { xp: number }

const ALECA_KEY = new TextEncoder().encode('LEO-ALEC\tEO-ALEC')
const ALECA_IV = new Uint8Array([49, 50, 70, 71, 66, 51, 54, 45, 76, 69, 51, 45, 113, 61, 57, 0])

/**
 * Local implementation of the public AlecaFrame inventory parser algorithm.
 * It mirrors the parser's AES-CBC/PKCS7 step and never uploads the selected file.
 */
export async function parseAlecaFrameFile(file: File): Promise<InventoryRecord> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const plainTextCandidate = new TextDecoder().decode(bytes).replace(/^\uFEFF/, '').trim()

  // Some AlecaFrame/Inventory Parser exports are JSON despite using a .dat
  // extension. Check that form before attempting AES-CBC decryption.
  if (plainTextCandidate.startsWith('{') || plainTextCandidate.startsWith('[')) {
    try {
      return parseInventoryJson(plainTextCandidate)
    } catch {
      // Continue with the encrypted format when the bytes only happened to
      // start like JSON.
    }
  }

  const cryptoKey = await crypto.subtle.importKey('raw', ALECA_KEY, { name: 'AES-CBC' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv: ALECA_IV }, cryptoKey, bytes)
  const decoded = new TextDecoder().decode(plain).replace(/^\uFEFF/, '')
  const outer = JSON.parse(decoded) as InventoryRecord

  if (typeof outer.InventoryJson === 'string') {
    return JSON.parse(outer.InventoryJson) as InventoryRecord
  }

  return outer
}

export function parseInventoryJson(text: string): InventoryRecord {
  const value = JSON.parse(text) as InventoryRecord
  return typeof value.InventoryJson === 'string'
    ? JSON.parse(value.InventoryJson) as InventoryRecord
    : value
}

export function collectItemCounts(inventory: unknown): Map<string, number> {
  const counts = new Map<string, number>()

  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }

    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const itemType = record.ItemType
    if (typeof itemType === 'string' && itemType.length > 0) {
      const rawCount = record.ItemCount
      const count = typeof rawCount === 'number' ? rawCount : 1
      counts.set(itemType, (counts.get(itemType) ?? 0) + count)
    }

    for (const [key, child] of Object.entries(record)) {
      if (key !== 'ItemType' && key !== 'ItemCount' && key !== 'ItemId') visit(child)
    }
  }

  visit(inventory)
  return counts
}

export function collectRelicCounts(inventory: unknown, aliases: Record<string, string> = {}): Map<string, number> {
  const counts = new Map<string, number>()
  const aliasByNormalizedPath = new Map(Object.entries(aliases).map(([key, name]) => [key.toLowerCase(), name]))
  const normalizeRelicName = (value: string, tierHint?: string) => {
    const shortName = value.replace(/(Intact|Exceptional|Flawless|Radiant)$/i, '')
    const match = shortName.match(/^(Lith|Meso|Neo|Axi|Requiem)([A-Z]?\d+)$/i)
    if (match) return `${match[1][0].toUpperCase()}${match[1].slice(1).toLowerCase()} ${match[2].toUpperCase()}`
    const bareRelic = shortName.match(/^([A-Z]?\d+)$/i)
    return bareRelic && tierHint ? `${tierHint} ${bareRelic[1].toUpperCase()}` : shortName
  }
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const itemType = typeof record.ItemType === 'string' ? record.ItemType : ''
    if (itemType.includes('/Relics/') || itemType.includes('/Projections/')) {
      const segments = itemType.split('/')
      const tierHint = segments.find((segment) => /^(Lith|Meso|Neo|Axi|Requiem)$/i.test(segment))
      const name = aliasByNormalizedPath.get(itemType.toLowerCase()) ?? aliasByNormalizedPath.get(itemType.replace(/(Bronze|Silver|Gold)$/i, '').toLowerCase()) ?? normalizeRelicName(segments.pop() ?? itemType, tierHint)
      const count = typeof record.ItemCount === 'number' ? record.ItemCount : 1
      counts.set(name, (counts.get(name) ?? 0) + count)
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'ItemType' && key !== 'ItemCount' && key !== 'ItemId') visit(child)
    }
  }
  visit(inventory)
  return counts
}

export function collectEquipmentProgress(inventory: unknown): Map<string, EquipmentProgress> {
  const progress = new Map<string, EquipmentProgress>()
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) visit(entry)
      return
    }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    const itemType = typeof record.ItemType === 'string' ? record.ItemType : ''
    const xp = typeof record.XP === 'number' ? record.XP : null
    if (itemType && xp !== null) {
      const key = itemType.toLowerCase()
      const previous = progress.get(key)
      progress.set(key, { xp: Math.max(previous?.xp ?? 0, xp) })
    }
    for (const [key, child] of Object.entries(record)) {
      // XPInfo records history for equipment that may have been sold.  Current
      // ownership must only be inferred from the actual equipment bins.
      if (key !== 'ItemType' && key !== 'XP' && key !== 'ItemId' && key !== 'XPInfo') visit(child)
    }
  }
  visit(inventory)
  return progress
}

/** XPInfo is the account's permanent equipment-affinity history. */
export function collectMasteryProgress(inventory: unknown): Map<string, EquipmentProgress> {
  const progress = new Map<string, EquipmentProgress>()
  const records = inventory && typeof inventory === 'object' ? (inventory as Record<string, unknown>).XPInfo : undefined
  if (!Array.isArray(records)) return progress

  for (const entry of records) {
    if (!entry || typeof entry !== 'object') continue
    const record = entry as Record<string, unknown>
    const itemType = typeof record.ItemType === 'string' ? record.ItemType : ''
    const xp = typeof record.XP === 'number' ? record.XP : null
    if (!itemType || xp === null) continue
    const key = itemType.toLowerCase()
    const previous = progress.get(key)
    progress.set(key, { xp: Math.max(previous?.xp ?? 0, xp) })
  }
  return progress
}
