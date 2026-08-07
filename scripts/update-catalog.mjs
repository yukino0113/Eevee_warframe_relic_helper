import { mkdir, readdir, writeFile } from 'node:fs/promises'

const OFFICIAL_DROPS_URL = 'https://warframe-web-assets.nyc3.cdn.digitaloceanspaces.com/uploads/cms/hnfvc0o3jnfvc873njb03enrf56.html'
const ITEMS_URL = 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/All.json'
const RELICS_URL = 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/Relics.json'
const I18N_URL = 'https://raw.githubusercontent.com/WFCD/warframe-items/master/data/json/i18n.json'
const WORLDSTATE_URL = 'https://api.warframe.com/cdn/worldState.php'
const IMAGE_CDN = 'https://cdn.warframestat.us/img/'
const OUTPUT_PATH = new URL('../src/data/catalog.generated.json', import.meta.url)
const ASSET_DIR = new URL('../public/assets/prime/', import.meta.url)

const fetchJson = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
  return JSON.parse(await response.text())
}

const fetchText = async (url) => {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`)
  return response.text()
}

const decodeHtml = (value) => String(value ?? '')
  .replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&')
  .replace(/&quot;/gi, '"')
  .replace(/&#39;|&apos;/gi, "'")
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))

const cellText = (value) => decodeHtml(String(value ?? '')
  .replace(/<br\s*\/?\s*>/gi, ' ')
  .replace(/<[^>]+>/g, ' '))
  .replace(/\s+/g, ' ')
  .trim()

const tableRows = (html) => [...String(html ?? '').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
  .map((match) => ({
    raw: match[1],
    cells: [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => cellText(cell[1])),
  }))

const sectionAfterHeading = (html, heading) => {
  const match = String(html).match(heading)
  if (!match || match.index === undefined) return ''
  const start = match.index + match[0].length
  const nextHeading = String(html).slice(start).search(/<h3\b/i)
  return String(html).slice(start, nextHeading < 0 ? undefined : start + nextHeading)
}

const percentageIn = (value) => {
  const match = String(value ?? '').match(/(\d+(?:\.\d+)?)\s*%/)
  return match ? Number(match[1]) : null
}

const relicNameFromCell = (value) => {
  const text = cellText(value)
  if (!/^(?:Lith|Meso|Neo|Axi|Requiem|Omnia|Abyssal)\s+.+\s+Relic$/i.test(text)) return null
  return text.replace(/\s+Relic$/i, '')
}

const relicNameFromHeader = (value) => cellText(value).replace(/\s+Relic\s+\((?:Intact|Exceptional|Flawless|Radiant)\)$/i, '').trim()

const parseOfficialRelics = (html) => {
  const records = new Map()
  let currentName = null
  const section = sectionAfterHeading(html, /<h3\b[^>]*>\s*Relics:\s*<\/h3>/i)
  for (const row of tableRows(section)) {
    const firstCell = row.cells[0] ?? ''
    const header = firstCell.match(/^(.+?)\s+Relic\s+\((Intact|Exceptional|Flawless|Radiant)\)$/i)
    if (header) {
      currentName = header[2].toLowerCase() === 'intact' ? relicNameFromHeader(firstCell) : null
      if (currentName && !records.has(currentName)) {
        records.set(currentName, { name: currentName, era: currentName.split(/\s+/)[0], rewards: [] })
      }
      continue
    }
    if (!currentName || row.cells.length < 2) continue
    const chance = percentageIn(row.cells.join(' '))
    if (chance === null) continue
    const itemName = row.cells.find((cell) => /\bPrime\b/i.test(cell) && !/(?:Common|Uncommon|Rare)\b/i.test(cell))
      ?? row.cells[0]
    if (!itemName || /^(?:Item|Reward|Rarity|Chance)$/i.test(itemName)) continue
    const rarity = row.cells.find((cell) => /^(?:Common|Uncommon|Rare)\b/i.test(cell))?.match(/^(Common|Uncommon|Rare)/i)?.[1]
      ?? rarityFromChance(chance)
    const record = records.get(currentName)
    if (!record || record.rewards.some((reward) => reward.itemName === itemName)) continue
    record.rewards.push({ itemName, rarity, chance })
  }
  if (!records.size) throw new Error('The official drops page did not contain an Intact relic reward table.')
  return records
}

const parseOfficialRelicSources = (html) => {
  const availableRelics = new Set()
  const sources = new Map()
  let currentSource = null
  const section = sectionAfterHeading(html, /<h3\b[^>]*id=["']relicByAvatar["'][^>]*>\s*Relic Drops by Source:\s*<\/h3>/i)
  for (const row of tableRows(section)) {
    const sourceHeader = row.cells.find((cell) => /Relic Drop Chance:/i.test(cell))
    if (sourceHeader) {
      currentSource = row.cells.find((cell) => !/Relic Drop Chance:/i.test(cell)) || null
      continue
    }
    const relicCell = row.cells.map(relicNameFromCell).find(Boolean)
    if (!relicCell || !currentSource) continue
    availableRelics.add(relicCell)
    const list = sources.get(relicCell) ?? []
    list.push({ source: currentSource, chance: percentageIn(row.cells.join(' ')) ?? 0 })
    sources.set(relicCell, list)
  }
  if (!availableRelics.size) throw new Error('The official drops page did not contain a relic source table.')
  return { availableRelics, sources }
}

const parseMissionHeader = (value) => {
  const match = cellText(value).match(/^(.+?)\s*\(([^()]+)\)$/)
  if (!match) return null
  const slash = match[1].lastIndexOf('/')
  if (slash < 1 || slash === match[1].length - 1) return null
  return { planet: match[1].slice(0, slash).trim(), mission: match[1].slice(slash + 1).trim(), gameMode: match[2].trim() }
}

const parseOfficialMissions = (html) => {
  const missionRewards = {}
  let current = null
  let rotation = null
  const section = sectionAfterHeading(html, /<h3\b[^>]*>\s*Missions:\s*<\/h3>/i)
  for (const row of tableRows(section)) {
    const rowText = row.cells.join(' ')
    const mission = row.cells.map(parseMissionHeader).find(Boolean)
    if (mission) {
      current = mission
      rotation = null
      missionRewards[current.planet] ??= {}
      missionRewards[current.planet][current.mission] ??= { gameMode: current.gameMode, rewards: {} }
      continue
    }
    const rotationMatch = rowText.match(/^Rotation\s+([ABC])(?:\s|$)/i)
    if (rotationMatch) {
      rotation = rotationMatch[1].toUpperCase()
      continue
    }
    if (!current || !rotation) continue
    const relicCell = row.cells.map(relicNameFromCell).find(Boolean)
    const chance = percentageIn(rowText)
    if (!relicCell || chance === null) continue
    const detail = missionRewards[current.planet][current.mission]
    detail.rewards[rotation] ??= []
    detail.rewards[rotation].push({ itemName: `${relicCell} Relic`, chance })
  }
  if (!Object.keys(missionRewards).length) throw new Error('The official drops page did not contain a mission reward table.')
  return missionRewards
}

const normalize = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
const dateMillis = (value) => Number(value?.['$date']?.['$numberLong'] ?? value ?? 0)
const rarityFromChance = (chance, fallback = null) => {
  const value = Number(chance)
  if (value >= 20) return 'Common'
  if (value >= 5) return 'Uncommon'
  if (value > 0) return 'Rare'
  return fallback || 'Rare'
}
const capProbability = (value) => value === null ? null : Number(Math.min(100, Math.max(0, value)).toFixed(2))
const factionByPlanet = {
  Mercury: 'Grineer', Venus: 'Corpus', Earth: 'Grineer', Mars: 'Grineer', Phobos: 'Corpus', Ceres: 'Grineer', Jupiter: 'Corpus', Saturn: 'Grineer', Uranus: 'Grineer', Neptune: 'Corpus', Pluto: 'Corpus', Europa: 'Corpus', Sedna: 'Grineer', Eris: 'Infested', Deimos: 'Infested', Lua: 'Corpus', Void: 'Corrupted', 'Kuva Fortress': 'Grineer', 'Zariman Ten Zero': 'Corpus', 'Höllvania': 'Scaldra', Duviri: 'Orokin', EarthRemastered: 'Grineer', MarsRemastered: 'Grineer', VenusRemastered: 'Corpus', 'Cetus (Earth)': 'Grineer', 'Orb Vallis (Venus)': 'Corpus', 'Cambion Drift (Deimos)': 'Infested', 'The Sanctum Anatomica': 'Murmur',
}

const primePartFromReward = (itemName) => {
  if (typeof itemName !== 'string' || !itemName.includes(' Prime')) return null
  const isBlueprint = / Blueprint$/i.test(itemName)
  const withoutBlueprint = itemName.replace(/ Blueprint$/i, '')
  const match = withoutBlueprint.match(/^(.+ Prime)(?: (.+))$/i)
  if (!match) return isBlueprint ? { item: withoutBlueprint, part: 'Blueprint' } : null
  return { item: match[1], part: match[2] }
}

const buildSourceMap = (missionRewards) => {
  const sources = new Map()
  for (const [planet, missions] of Object.entries(missionRewards ?? {})) {
    for (const [mission, detail] of Object.entries(missions ?? {})) {
      for (const [rotation, rewards] of Object.entries(detail?.rewards ?? {})) {
        for (const reward of (Array.isArray(rewards) ? rewards : []).filter(Boolean)) {
        if (typeof reward.itemName !== 'string' || !/ Relic$/i.test(reward.itemName)) continue
        const name = reward.itemName.replace(/ Relic$/i, '')
        const location = {
          planet,
          mission,
          gameMode: detail.gameMode || 'Mission',
          rotation: ['A', 'B', 'C'].includes(rotation) ? rotation : null,
          label: `${detail.gameMode || 'Mission'} · ${mission} (${planet}) · ${rotation}`,
          chance: Number(reward.chance) || 0,
        }
        const list = sources.get(name) ?? []
        const existing = list.find((entry) => entry.planet === location.planet && entry.mission === location.mission && entry.gameMode === location.gameMode && entry.rotation === location.rotation)
        if (!existing) list.push(location)
        else if (location.chance > existing.chance) existing.chance = location.chance
        sources.set(name, list)
        }
      }
    }
  }
  return sources
}

const buildRouteGroups = (missionRewards) => {
  const groups = new Map()
  for (const [planet, missions] of Object.entries(missionRewards ?? {})) {
    for (const [mission, detail] of Object.entries(missions ?? {})) {
      const gameMode = detail?.gameMode || 'Mission'
      const faction = factionByPlanet[planet] || 'Unknown'
      const rotations = {}
      for (const label of ['A', 'B', 'C']) {
        const rewards = Array.isArray(detail?.rewards?.[label]) ? detail.rewards[label] : []
        const relicRewards = rewards.filter((reward) => typeof reward?.itemName === 'string' && / Relic$/i.test(reward.itemName))
        const relicDrops = [...relicRewards.reduce((drops, reward) => {
          const name = reward.itemName.replace(/ Relic$/i, '')
          drops.set(name, (drops.get(name) ?? 0) + (Number(reward.chance) || 0))
          return drops
        }, new Map()).entries()].map(([name, chance]) => ({ name, chance: capProbability(chance) })).sort((left, right) => left.name.localeCompare(right.name))
        rotations[label] = {
          chance: relicDrops.length ? capProbability(relicDrops.reduce((sum, drop) => sum + drop.chance, 0)) : null,
          relicNames: relicDrops.map((drop) => drop.name),
          relicDrops,
        }
      }
      const activeRotations = ['A', 'B', 'C'].filter((label) => rotations[label].chance !== null)
      if (!activeRotations.length) continue
      const signature = `${gameMode}::${faction}::${activeRotations.map((label) => `${label}:${rotations[label].relicDrops.map((drop) => `${drop.name}:${drop.chance}`).join(',')}`).join('|')}`
      const group = groups.get(signature) ?? {
        id: normalize(signature),
        gameMode,
        faction,
        rotations: { A: { chance: null, relicNames: [], relicDrops: [] }, B: { chance: null, relicNames: [], relicDrops: [] }, C: { chance: null, relicNames: [], relicDrops: [] } },
        missions: [],
        relicNames: [],
        _samples: { A: [], B: [], C: [] },
      }
      group.missions.push(`${mission} (${planet})`)
      for (const label of ['A', 'B', 'C']) {
        if (rotations[label].chance === null) continue
        group._samples[label].push(rotations[label].chance)
        group.rotations[label].relicNames = rotations[label].relicNames
        group.rotations[label].relicDrops = rotations[label].relicDrops
        group.rotations[label].chance = Number((group._samples[label].reduce((sum, value) => sum + value, 0) / group._samples[label].length).toFixed(2))
        group.relicNames = [...new Set([...group.relicNames, ...rotations[label].relicNames])].sort()
      }
      groups.set(signature, group)
    }
  }
  return [...groups.values()].map((group) => {
    const values = ['A', 'B', 'C'].map((label) => group.rotations[label].chance).filter((value) => value !== null)
    return {
      id: group.id,
      gameMode: group.gameMode,
      faction: group.faction,
      averageChance: Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)),
      rotations: group.rotations,
      missions: group.missions.sort(),
      relicNames: group.relicNames,
    }
  }).sort((a, b) => b.averageChance - a.averageChance || a.gameMode.localeCompare(b.gameMode))
}

const formatDate = (timestamp) => timestamp ? new Date(timestamp).toISOString() : null

const downloadAsset = async (imageName) => {
  if (!imageName || imageName.includes('/') || imageName.includes('\\')) return null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(`${IMAGE_CDN}${encodeURIComponent(imageName)}`)
      if (!response.ok) {
        if (response.status === 404) return null
        throw new Error(`HTTP ${response.status}`)
      }
      await writeFile(new URL(imageName, ASSET_DIR), Buffer.from(await response.arrayBuffer()))
      return `/assets/prime/${imageName}`
    } catch {
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
    }
  }
  return null
}

const downloadAssets = async (imageNames) => {
  const existing = new Set(await readdir(ASSET_DIR))
  const paths = new Map()
  const pending = [...imageNames]
  let nextIndex = 0
  const worker = async () => {
    while (nextIndex < pending.length) {
      const imageName = pending[nextIndex]
      nextIndex += 1
      const path = existing.has(imageName) ? `/assets/prime/${imageName}` : await downloadAsset(imageName)
      if (path) paths.set(imageName, path)
    }
  }
  await Promise.all(Array.from({ length: 8 }, () => worker()))
  return paths
}

const masterySlot = (item) => item.category === 'Warframes' || ['Suits', 'SpaceSuits', 'MechSuits'].includes(item.productCategory)
  ? 'Warframe'
  : item.category === 'Primary' || item.productCategory === 'LongGuns'
    ? 'Primary'
    : item.category === 'Secondary' || item.productCategory === 'Pistols'
      ? 'Secondary'
      : item.category === 'Melee' || item.productCategory === 'Melee' || item.productCategory === 'SpaceMelee'
        ? 'Melee'
        : 'Other'

const masteryKind = (item) => masterySlot(item) === 'Warframe' ? 'Warframe' : ['Primary', 'Secondary', 'Melee'].includes(masterySlot(item)) ? 'Weapon' : 'Other'

const masteryXpRequired = (item) => {
  const cap = Number(item.maxLevelCap) || 30
  const isWeapon = masteryKind(item) === 'Weapon'
  return (isWeapon ? 500 : 1000) * cap ** 2
}

const dropRotation = (location) => {
  const match = String(location ?? '').match(/(?:rotation\s*)?\b([ABC])\b/i)
  return match ? match[1].toUpperCase() : null
}

const manualTraditionalNames = { 'Kavasa Prime': '卡瓦薩 Prime' }
const localizedTraditionalName = (localizations, uniqueName, fallbackName = '') => localizations?.[uniqueName]?.tc?.name || manualTraditionalNames[fallbackName] || null

const buildMasteryItems = (items, imagePaths, localizations) => items
  .filter((item) => item.masterable === true && item.name && item.uniqueName)
  .map((item) => {
    const components = (Array.isArray(item.components) ? item.components : [])
      .filter((component) => component?.name && component?.uniqueName)
      .map((component) => ({
        name: component.name,
        nameZh: localizedTraditionalName(localizations, component.uniqueName),
        uniqueName: component.uniqueName,
        quantity: Number(component.itemCount) || 1,
        imageUrl: imagePaths.get(component.imageName) ?? imagePaths.get('OmegaIsotope.png'),
        drops: (Array.isArray(component.drops) ? component.drops : [])
          .filter((drop) => drop?.location && Number(drop.chance) > 0)
          .map((drop) => ({ location: drop.location, rotation: dropRotation(drop.location), chance: Number(drop.chance) || 0, rarity: drop.rarity ?? null }))
          .sort((a, b) => b.chance - a.chance || a.location.localeCompare(b.location))
          .slice(0, 12),
      }))
    const leaf = item.uniqueName.split('/').filter(Boolean).pop() ?? item.uniqueName
    return {
      id: `${normalize(item.name)}-${normalize(item.uniqueName)}`,
      name: item.name,
      nameZh: localizedTraditionalName(localizations, item.uniqueName),
      uniqueName: item.uniqueName,
      category: item.category || item.type || 'Other',
      productCategory: item.productCategory || 'Other',
      kind: masteryKind(item),
      slot: masterySlot(item),
      masteryReq: Number(item.masteryReq) || 0,
      maxLevelCap: Number(item.maxLevelCap) || 30,
      masteryXpRequired: masteryXpRequired(item),
      isPrime: /\bPrime\b/i.test(item.name),
      imageUrl: imagePaths.get(item.imageName) ?? imagePaths.get('OmegaIsotope.png'),
      ownedKeys: [item.uniqueName, item.name, leaf, `${item.name} Weapon`, `${item.name} PowerSuit`],
      components,
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name) || a.uniqueName.localeCompare(b.uniqueName))

const main = async () => {
  const [itemsData, relicItemsData, worldState, localizations, officialDropsHtml] = await Promise.all([
    fetchJson(ITEMS_URL),
    fetchJson(RELICS_URL),
    fetchJson(WORLDSTATE_URL),
    fetchJson(I18N_URL),
    fetchText(OFFICIAL_DROPS_URL),
  ])

  const officialRelicRecords = parseOfficialRelics(officialDropsHtml)
  const officialRelicSources = parseOfficialRelicSources(officialDropsHtml)
  const officialMissionRewards = parseOfficialMissions(officialDropsHtml)

  const items = Array.isArray(itemsData) ? itemsData : Object.values(itemsData ?? {})
  const itemInfo = new Map(items.filter((item) => item.name && item.imageName).map((item) => [item.name, item]))
  const masteryCatalogItems = items.filter((item) => item.masterable === true && item.name && item.uniqueName)
  const relicItems = Array.isArray(relicItemsData) ? relicItemsData : Object.values(relicItemsData ?? {})
  const relicImageInfo = new Map(relicItems.filter((item) => item.name && item.imageName).map((item) => [item.name.replace(/ (Intact|Exceptional|Flawless|Radiant)$/i, ''), item.imageName]))
  const relicAliases = {}
  for (const item of relicItems) {
    if (!item.name || !item.uniqueName) continue
    const baseName = item.name.replace(/ (Intact|Exceptional|Flawless|Radiant)$/i, '')
    relicAliases[item.uniqueName] = baseName
    relicAliases[item.uniqueName.replace(/(Bronze|Silver|Gold)$/i, '')] = baseName
  }
  const primeRewards = new Map()
  const relicRecords = new Map()

  for (const [name, rawRelic] of officialRelicRecords.entries()) {
    const rewards = rawRelic.rewards.map((reward) => {
      const part = primePartFromReward(reward.itemName)
      return {
        ...part,
        itemName: reward.itemName,
        itemZh: part ? localizedTraditionalName(localizations, itemInfo.get(part.item)?.uniqueName, part.item) : null,
        rarity: rarityFromChance(reward.chance, reward.rarity),
        chance: Number(reward.chance) || 0,
      }
    }).filter((reward) => reward.item)
    relicRecords.set(name, { name, era: rawRelic.era, rewards })
    for (const reward of rewards) {
      const key = `${reward.item}::${reward.part}`
      const occurrences = primeRewards.get(key) ?? []
      occurrences.push({ relic: name, rarity: reward.rarity, chance: reward.chance })
      primeRewards.set(key, occurrences)
    }
  }

  const availableRelicNames = [...officialRelicSources.availableRelics]
    .filter((name) => relicRecords.has(name))
    .sort((a, b) => a.localeCompare(b))
  const availableRelicSet = new Set(availableRelicNames)
  const availablePrimeItemNames = [...new Set(
    [...relicRecords.values()]
      .filter((relic) => availableRelicSet.has(relic.name))
      .flatMap((relic) => relic.rewards.map((reward) => reward.item).filter(Boolean)),
  )].sort((a, b) => a.localeCompare(b))

  const itemNames = [...new Set([...primeRewards.keys()].map((key) => key.split('::')[0]))]
  const now = Date.now()
  const activeRotation = (worldState.PrimeVaultTraders ?? []).find((entry) => {
    const activation = dateMillis(entry.Activation)
    const expiry = dateMillis(entry.Expiry)
    return activation <= now && now < expiry
  })
  const manifestTypes = (activeRotation?.Manifest ?? []).map((entry) => entry.ItemType).filter(Boolean)
  const itemTypeVariants = new Map(items.filter((item) => itemNames.includes(item.name) && item.uniqueName).map((item) => [item.name, [
    item.uniqueName,
    item.uniqueName.replace('/Lotus/', '/Lotus/StoreItems/'),
  ]]))
  const exactFeaturedItems = itemNames.filter((itemName) => {
    const variants = itemTypeVariants.get(itemName) ?? []
    return manifestTypes.some((itemType) => variants.some((variant) => normalize(itemType) === normalize(variant)))
  })
  const heuristicFeaturedItems = itemNames.filter((itemName) => {
    const stem = normalize(itemName.replace(/\s+Prime$/i, ''))
    return manifestTypes.some((itemType) => {
      const path = normalize(itemType)
      return path.includes(`${stem}prime`) || path.includes(`prime${stem}`) || (stem.length >= 4 && path.includes(stem) && path.includes('prime'))
    })
  })
  const featuredItems = exactFeaturedItems.length ? exactFeaturedItems : (heuristicFeaturedItems.length ? heuristicFeaturedItems : [])
  const selectedItemSet = new Set(itemNames)
  await mkdir(ASSET_DIR, { recursive: true })
  const componentImageNames = masteryCatalogItems.flatMap((item) => item.components?.map((component) => component.imageName) ?? [])
  const imageNames = new Set(['OmegaIsotope.png', 'GenericComponentPrimePlug.png', ...masteryCatalogItems.map((item) => item.imageName).filter(Boolean), ...componentImageNames.filter(Boolean)])
  for (const relic of relicRecords.values()) imageNames.add(relicImageInfo.get(relic.name) ?? `${relic.era.toLowerCase()}-intact.png`)
  const imagePaths = await downloadAssets(imageNames)
  const masteryItems = buildMasteryItems(masteryCatalogItems, imagePaths, localizations)

  const parts = []
  for (const [key, occurrences] of primeRewards.entries()) {
    const [item, part] = key.split('::')
    if (!selectedItemSet.has(item)) continue
    const best = [...occurrences].sort((a, b) => (b.chance ?? 0) - (a.chance ?? 0))[0]
    const itemKey = normalize(`${item}${part}`)
    const itemStem = normalize(item.replace(/\s+Prime$/i, ''))
    const partKey = normalize(part)
    const ownedKeys = [...new Set([
      itemKey,
      `${itemKey}blueprint`,
      `${itemStem}${partKey}`,
      `prime${itemStem}${partKey}`,
      `${itemStem}prime${partKey}`,
    ])]
    parts.push({
      id: `${itemKey}-${partKey}`,
      item,
      itemZh: localizedTraditionalName(localizations, itemInfo.get(item)?.uniqueName, item),
      part,
      kind: itemInfo.get(item)?.category === 'Warframes' ? 'Warframe' : itemInfo.get(item)?.category ? 'Weapon' : 'Other',
      slot: itemInfo.get(item)?.category === 'Warframes' ? 'Warframe' : itemInfo.get(item)?.category === 'Primary' ? 'Primary' : itemInfo.get(item)?.category === 'Secondary' ? 'Secondary' : itemInfo.get(item)?.category === 'Melee' ? 'Melee' : 'Other',
      itemImageUrl: imagePaths.get(itemInfo.get(item)?.imageName) ?? imagePaths.get('GenericComponentPrimePlug.png') ?? imagePaths.get('OmegaIsotope.png'),
      imageUrl: imagePaths.get(itemInfo.get(item)?.components?.find((component) => normalize(component.name) === normalize(part))?.imageName ?? itemInfo.get(item)?.imageName) ?? imagePaths.get('GenericComponentPrimePlug.png') ?? imagePaths.get('OmegaIsotope.png'),
      rarity: best.rarity,
      ownedKey: itemKey,
      ownedKeys,
      bestRelic: best.relic,
    })
  }
  parts.sort((a, b) => a.item.localeCompare(b.item) || a.part.localeCompare(b.part))

  const sourceMap = buildSourceMap(officialMissionRewards)
  const routeGroups = buildRouteGroups(officialMissionRewards)
  const routes = [...relicRecords.values()].filter((relic) => relic.rewards.some((reward) => selectedItemSet.has(reward.item)))
    .map((relic) => {
      const locations = (sourceMap.get(relic.name) ?? []).sort((a, b) => b.chance - a.chance || a.label.localeCompare(b.label))
      return {
      name: relic.name,
      era: relic.era,
      owned: 0,
      isAya: !officialRelicSources.availableRelics.has(relic.name),
      imageUrl: imagePaths.get(relicImageInfo.get(relic.name) ?? `${relic.era.toLowerCase()}-intact.png`) ?? imagePaths.get('OmegaIsotope.png'),
      source: (locations.length ? locations.map((location) => location.label) : [officialRelicSources.availableRelics.has(relic.name)
        ? 'Official drop source listed outside the mission table'
        : 'Vaulted relic · check Varzia / Aya (availability follows official drop table)']).slice(0, 3).join(' · '),
      locations,
      rewards: relic.rewards.filter((reward) => selectedItemSet.has(reward.item)).map((reward) => ({ item: reward.item, itemZh: reward.itemZh, part: reward.part, rarity: reward.rarity, chance: Number(reward.chance) || 0 })),
    }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  const expiry = dateMillis(activeRotation?.Expiry)
  const featuredLabel = featuredItems.length ? featuredItems.join(' · ') : 'Prime relic catalog'
  const catalog = {
    generatedAt: new Date().toISOString(),
    sources: { officialDrops: OFFICIAL_DROPS_URL, items: ITEMS_URL, relics: RELICS_URL, worldState: WORLDSTATE_URL },
    rotation: {
      label: activeRotation ? `Prime Resurgence · ${featuredLabel}` : 'Prime relic catalog',
      featuredItems,
      activation: dateMillis(activeRotation?.Activation) || null,
      expiry: expiry || null,
      resetDate: formatDate(expiry),
    },
    primeParts: parts,
    masteryItems,
    relicRoutes: routes,
    routeGroups,
    availableRelicNames,
    availablePrimeItemNames,
    relicAliases,
  }

  await mkdir(new URL('../src/data', import.meta.url), { recursive: true })
  await writeFile(OUTPUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8')
  console.log(`Updated ${OUTPUT_PATH.pathname}`)
  console.log(`Featured items: ${featuredItems.join(', ')}`)
  console.log(`Prime parts: ${parts.length}; relic routes: ${routes.length}`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
