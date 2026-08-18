import { collectEquipmentProgress, collectItemCounts, collectMasteryProgress, collectPendingRecipeCounts, collectRelicCounts } from './inventoryParser'
import type { InventorySnapshot } from './fileStore'
import { availablePrimeItemNames, availableRelicNames, catalog, demoOwned, getCurrentRotation, masteryItems, primeParts, relicAliases, relicRoutes, routeGroups, type MasteryEquipment, type PrimePart, type RelicRoute, type RelicRouteGroup } from '../data/primeData'

const normalizeKey = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '')

export const countOwnedPart = (rawOwned: Map<string, number>, item: PrimePart) => {
  const aliases = item.ownedKeys.map(normalizeKey)
  const completedItem = normalizeKey(item.item)
  const itemStem = normalizeKey(item.item.replace(/\s+Prime$/i, ''))
  const partKey = normalizeKey(item.part)
  let count = 0

  for (const [rawKey, rawCount] of rawOwned) {
    const key = normalizeKey(rawKey)
    const leaf = normalizeKey(rawKey.split('/').pop() ?? rawKey)
    const signatureMatches = itemStem.length > 3 && partKey.length > 2 && key.includes(itemStem) && key.includes(partKey) && key.includes('prime')
    if (signatureMatches || aliases.some((alias) => alias.length > 3 && key.includes(alias))) {
      count += rawCount
      continue
    }

    // A completed Prime item is evidence that its component was owned and built.
    const isCompletedItem = leaf === completedItem || ['weapon', 'warframe', 'powersuit', 'item'].some((suffix) => leaf === `${completedItem}${suffix}`)
    if (completedItem.length > 3 && isCompletedItem && !key.includes('relic')) count = Math.max(count, rawCount)
  }

  return count
}

const aliasesMatch = (rawKey: string, aliases: string[]) => {
  const key = normalizeKey(rawKey)
  // Inventory paths contain the item identifier, while the catalog aliases may
  // add a variant suffix (for example, "Kronen Prime").  Matching in the
  // reverse direction turns a base item such as "Kronen" into a false match
  // for "Kronen Prime", incorrectly marking the Prime item as owned.
  return aliases.some((alias) => alias.length > 3 && key.includes(alias))
}

const matchesEquipment = (rawKey: string, item: MasteryEquipment) => normalizeKey(rawKey) === normalizeKey(item.uniqueName)

export const getEquipmentProgress = (progress: Map<string, { xp: number }>, item: MasteryEquipment) => {
  let xp = 0
  for (const [rawKey, value] of progress) {
    if (matchesEquipment(rawKey, item)) xp = Math.max(xp, value.xp)
  }
  return xp
}

export const hasEquipmentProgress = (progress: Map<string, { xp: number }>, item: MasteryEquipment) => {
  return [...progress.keys()].some((rawKey) => matchesEquipment(rawKey, item))
}

export const countOwnedComponent = (rawOwned: Map<string, number>, uniqueName: string, name: string) => {
  const aliases = [uniqueName, name].map(normalizeKey)
  let count = 0
  for (const [rawKey, rawCount] of rawOwned) {
    if (aliasesMatch(rawKey, aliases)) count += rawCount
  }
  return count
}

const recipeLeaf = (rawKey: string) => rawKey.split('/').pop() ?? rawKey
const pendingRecipeResultKey = (rawKey: string) => normalizeKey(recipeLeaf(rawKey).replace(/(?:Blueprint|Component)$/i, ''))
const pendingFinalRecipeCount = (pendingRecipes: Map<string, number>, item: MasteryEquipment) => {
  const itemKey = normalizeKey(item.name)
  let count = 0
  for (const [rawKey, rawCount] of pendingRecipes) {
    if (normalizeKey(recipeLeaf(rawKey).replace(/Blueprint$/i, '')) === itemKey) count += rawCount
  }
  return count
}

const pendingRecipePartAliases = (part: PrimePart) => {
  // Warframe recipes call the Neuroptics component a Helmet.
  return part.part === 'Neuroptics' ? ['Neuroptics', 'Helmet'] : [part.part]
}

const pendingRecipeMatchesPart = (rawKey: string, part: PrimePart) => {
  if (part.part === 'Blueprint') return false
  const recipeKey = pendingRecipeResultKey(rawKey)
  const itemKey = normalizeKey(part.item)
  return recipeKey.startsWith(itemKey) && pendingRecipePartAliases(part).some((alias) => recipeKey.endsWith(normalizeKey(alias)))
}

const countPendingRecipePart = (pendingRecipes: Map<string, number>, part: PrimePart) => {
  let count = 0
  for (const [rawKey, rawCount] of pendingRecipes) {
    if (pendingRecipeMatchesPart(rawKey, part)) count += rawCount
  }
  return count
}

const countPendingComponent = (pendingRecipes: Map<string, number>, uniqueName: string) => {
  const componentKey = pendingRecipeResultKey(uniqueName)
  let count = 0
  for (const [rawKey, rawCount] of pendingRecipes) {
    if (pendingRecipeResultKey(rawKey) === componentKey) count += rawCount
  }
  return count
}

const masteryXpRequired = (item: MasteryEquipment) => (item.kind === 'Weapon' ? 500 : 1000) * item.maxLevelCap ** 2

export type DashboardData = {
  rotation: ReturnType<typeof getCurrentRotation>
  missing: Array<PrimePart & { owned: number }>
  parts: Array<PrimePart & { owned: number }>
  relics: Array<RelicRoute & { owned: number; missingRewards: RelicRoute['rewards']; recommendationScore: number }>
  unownedRelics: Array<RelicRoute & { owned: number; missingRewards: RelicRoute['rewards']; recommendationScore: number }>
  routeGroups: Array<RelicRouteGroup & { unownedRelicCount: number }>
  masteryItems: Array<MasteryEquipment & { xp: number; owned: boolean; mastered: boolean; missingComponents: MasteryEquipment['components'] }>
  inventoryCount: number
  owned: Map<string, number>
  imported: boolean
  sourceLabel: string
  catalogUpdatedAt: string
  availableRelicNames: string[]
  availablePrimeItemNames: string[]
}

const mapToRecord = (map: Map<string, number>) => Object.fromEntries(map.entries())
const recordToMap = (record: Record<string, number> | undefined) => new Map(Object.entries(record ?? {}))

export const createInventorySnapshot = (inventory: unknown, source: InventorySnapshot['source']): InventorySnapshot => {
  const equipmentProgress = collectEquipmentProgress(inventory)
  const masteryProgress = collectMasteryProgress(inventory)
  const pendingRecipes = collectPendingRecipeCounts(inventory)
  return {
    schemaVersion: 1,
    importedAt: Date.now(),
    source,
    itemCounts: mapToRecord(collectItemCounts(inventory)),
    relicCounts: mapToRecord(collectRelicCounts(inventory, relicAliases)),
    pendingRecipes: mapToRecord(pendingRecipes),
    equipmentProgress: Object.fromEntries([...equipmentProgress.entries()].map(([key, value]) => [key, value.xp])),
    masteryProgress: Object.fromEntries([...masteryProgress.entries()].map(([key, value]) => [key, value.xp])),
  }
}

export function analyzeInventory(inventory?: unknown): DashboardData {
  if (inventory && typeof inventory === 'object' && (inventory as { schemaVersion?: unknown }).schemaVersion === 1 && 'itemCounts' in inventory) {
    return analyzeInventorySnapshot(inventory as InventorySnapshot)
  }
  if (!inventory) return analyzeMaps(new Map(demoOwned), new Map(relicRoutes.map((route) => [route.name, route.owned])), new Map(), new Map(), new Map(), false, 'Demo inventory 繚 replace with import')
  return analyzeMaps(collectItemCounts(inventory), collectRelicCounts(inventory, relicAliases), collectEquipmentProgress(inventory), collectMasteryProgress(inventory), collectPendingRecipeCounts(inventory), true, 'AlecaFrame local file')
}

export function analyzeInventorySnapshot(snapshot: InventorySnapshot): DashboardData {
  const equipmentProgress = new Map(Object.entries(snapshot.equipmentProgress ?? {}).map(([key, xp]) => [key, { xp }]))
  const masteryProgress = new Map(Object.entries(snapshot.masteryProgress ?? {}).map(([key, xp]) => [key, { xp }]))
  return analyzeMaps(recordToMap(snapshot.itemCounts), recordToMap(snapshot.relicCounts), equipmentProgress, masteryProgress, recordToMap(snapshot.pendingRecipes), true, snapshot.source.kind === 'local-alecaframe' ? 'AlecaFrame local file' : 'Imported local file')
}

const analyzeMaps = (owned: Map<string, number>, relicCounts: Map<string, number>, equipmentProgress: Map<string, { xp: number }>, masteryProgress: Map<string, { xp: number }>, pendingRecipes: Map<string, number>, imported: boolean, sourceLabel: string): DashboardData => {
  const inventory = imported ? true : undefined
  const ownedEquipmentNames = new Set(masteryItems.filter((item) => hasEquipmentProgress(equipmentProgress, item) || getEquipmentProgress(masteryProgress, item) >= masteryXpRequired(item) || pendingFinalRecipeCount(pendingRecipes, item) > 0).map((item) => item.name))
  const parts = primeParts.map((part) => ({
    ...part,
    owned: Math.max(
      countOwnedPart(owned, part),
      countPendingRecipePart(pendingRecipes, part),
      ownedEquipmentNames.has(part.item) ? 1 : 0,
    ),
  }))
  const availablePrimeItemSet = new Set(availablePrimeItemNames)
  const missing = parts.filter((part) => availablePrimeItemSet.has(part.item) && part.owned < 1)
  const missingPartKeys = new Set(missing.map((part) => `${normalizeKey(part.item)}::${normalizeKey(part.part)}`))
  const relics = relicRoutes.map((route) => {
    const missingRewards = route.rewards.filter((reward) => missingPartKeys.has(`${normalizeKey(reward.item)}::${normalizeKey(reward.part)}`))
    const highestDropChance = route.locations.reduce((highest, location) => Math.max(highest, location.chance), 0)
    return {
      ...route,
      owned: relicCounts.get(route.name) ?? 0,
      missingRewards,
      recommendationScore: highestDropChance * missingRewards.length,
    }
  })
  // Keep every relic that contains a missing reward.  Whether vaulted relics are
  // visible is a presentation preference, applied by the individual pages.
  // Filtering them here caused missing components that only exist in a vaulted
  // relic to disappear from the relic list entirely.
  const unownedRelics = relics.filter((route) => route.missingRewards.length > 0)
  const unownedRelicNames = new Set(unownedRelics.map((route) => route.name))
  const analyzedRouteGroups = routeGroups
    .filter((route) => route.relicNames.some((name) => unownedRelicNames.has(name)))
    .map((route) => ({ ...route, unownedRelicCount: route.relicNames.filter((name) => unownedRelicNames.has(name)).length }))
  const analyzedMasteryItems = masteryItems.map((item) => {
    const xp = getEquipmentProgress(equipmentProgress, item)
    const masteryXp = getEquipmentProgress(masteryProgress, item)
    const itemOwned = imported && (hasEquipmentProgress(equipmentProgress, item) || pendingFinalRecipeCount(pendingRecipes, item) > 0)
    const mastered = masteryXp >= masteryXpRequired(item)
    const missingComponents = itemOwned ? [] : item.components.filter((component) => (
      countOwnedComponent(owned, component.uniqueName, component.name) + countPendingComponent(pendingRecipes, component.uniqueName) < component.quantity
    ))
    return { ...item, xp, owned: itemOwned, mastered, missingComponents }
  })

  return {
    rotation: getCurrentRotation(),
    missing,
    parts,
    relics,
    unownedRelics,
    routeGroups: analyzedRouteGroups,
    masteryItems: analyzedMasteryItems,
    inventoryCount: [...owned.values()].reduce((sum, count) => sum + count, 0),
    owned,
    imported,
    sourceLabel: inventory ? 'AlecaFrame local file' : 'Demo inventory · replace with import',
    catalogUpdatedAt: catalog.generatedAt,
    availableRelicNames,
    availablePrimeItemNames,
  }
}
