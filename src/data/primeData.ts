import generatedCatalog from './catalog.generated.json'

export type Rarity = 'Common' | 'Uncommon' | 'Rare'

export type PrimePart = {
  id: string
  item: string
  itemZh?: string | null
  part: string
  kind: 'Warframe' | 'Weapon' | 'Other'
  slot: 'Warframe' | 'Primary' | 'Secondary' | 'Melee' | 'Other'
  itemImageUrl?: string | null
  imageUrl?: string | null
  rarity: Rarity
  ownedKey: string
  ownedKeys: string[]
  bestRelic: string
}

export type RelicReward = {
  item: string
  itemZh?: string | null
  part: string
  rarity: Rarity
  chance: number
}

export type RelicLocation = {
  planet: string
  mission: string
  gameMode: string
  label: string
  chance: number
  rotation?: string | null
}

export type MasteryDrop = {
  location: string
  rotation?: string | null
  chance: number
  rarity?: string | null
}

export type MasteryComponent = {
  name: string
  nameZh?: string | null
  uniqueName: string
  quantity: number
  imageUrl?: string | null
  drops: MasteryDrop[]
}

export type MasteryEquipment = {
  id: string
  name: string
  nameZh?: string | null
  uniqueName: string
  category: string
  productCategory: string
  kind: 'Warframe' | 'Weapon' | 'Other'
  slot: 'Warframe' | 'Primary' | 'Secondary' | 'Melee' | 'Other'
  masteryReq: number
  maxLevelCap: number
  masteryXpRequired: number
  isPrime: boolean
  imageUrl?: string | null
  ownedKeys: string[]
  components: MasteryComponent[]
}

export type RouteRotation = {
  chance: number | null
  relicNames: string[]
  relicDrops: Array<{ name: string; chance: number }>
}

export type RelicRouteGroup = {
  id: string
  gameMode: string
  faction: string
  averageChance: number
  rotations: { A: RouteRotation; B: RouteRotation; C: RouteRotation }
  missions: string[]
  relicNames: string[]
}

export type RelicRoute = {
  name: string
  era: string
  owned: number
  isVaulted?: boolean
  imageUrl?: string | null
  source: string
  rewards: RelicReward[]
  locations: RelicLocation[]
}

type GeneratedCatalog = {
  generatedAt: string
  sources: { officialDrops: string; items: string; relics: string; worldState: string }
  rotation: {
    label: string
    featuredItems: string[]
    activation: number | null
    expiry: number | null
    resetDate: string | null
  }
  primeParts: PrimePart[]
  masteryItems: MasteryEquipment[]
  relicRoutes: RelicRoute[]
  routeGroups: RelicRouteGroup[]
  availableRelicNames: string[]
  availablePrimeItemNames: string[]
  relicAliases: Record<string, string>
}

export const catalog = generatedCatalog as GeneratedCatalog
export const primeParts = catalog.primeParts
export const masteryItems = catalog.masteryItems
export const relicRoutes = catalog.relicRoutes
export const routeGroups = catalog.routeGroups
export const availableRelicNames = catalog.availableRelicNames
export const availablePrimeItemNames = catalog.availablePrimeItemNames
export const relicAliases = catalog.relicAliases

const formatRemaining = (expiry: number | null) => {
  if (!expiry) return 'unknown'
  const remaining = Math.max(0, expiry - Date.now())
  const days = Math.floor(remaining / 86_400_000)
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000)
  return `${days}d ${hours}h`
}

const formatResetDate = (expiry: number | null) => expiry
  ? new Date(expiry).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : 'not available'

export const getCurrentRotation = () => ({
  ...catalog.rotation,
  resetsIn: formatRemaining(catalog.rotation.expiry),
  resetDate: formatResetDate(catalog.rotation.expiry),
})

export const demoOwned = new Map<string, number>()
