import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { analyzeInventory, analyzeInventorySnapshot, createInventorySnapshot, type DashboardData } from './lib/analyzer'
import { clearInventoryHandle, clearInventorySnapshot, loadInventoryHandle, loadInventorySnapshot, saveInventoryHandle, saveInventorySnapshot, type InventorySnapshot, type PersistentFileHandle } from './lib/fileStore'
import { parseAlecaFrameFile, parseInventoryJson } from './lib/inventoryParser'
import { translations, type Language, type Translation } from './lib/i18n'
import type { MasteryComponent, MasteryEquipment, RelicReward, RelicRoute, RelicRouteGroup } from './data/primeData'

type IconName = 'home' | 'parts' | 'relics' | 'settings' | 'upload' | 'help' | 'refresh' | 'external' | 'check' | 'info'
type NavItem = 'Overview' | 'Missing parts' | 'Relics' | 'Planner' | 'Prime Resurgence' | 'Void Fissures' | 'Mastery' | 'Settings'
type FileSource = InventorySnapshot['source'] & { persisted: boolean }
type FissureMission = { id: string; activation: string; expiry: string; node: string; missionType: string; missionTypeKey?: string; enemy: string; enemyKey?: string; tier: string; tierNum?: number; isStorm: boolean; isHard: boolean }

function getImportErrorMessage(error: unknown, language: Language) {
  const name = error instanceof DOMException ? error.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'NotReadableError') {
    return language === 'zh-TW'
      ? '瀏覽器無法讀取這個檔案。請先把 lastData.dat 複製到文件或其他一般資料夾，再重新選取。'
      : 'The browser could not read this file. Copy lastData.dat to Documents or another regular folder, then select it again.'
  }
  if (name === 'OperationError' || name === 'DataError') {
    return language === 'zh-TW'
      ? '無法解密這個 .dat 檔案，請確認選取的是 AlecaFrame 的 lastData.dat。'
      : 'Unable to decrypt this .dat file. Make sure it is AlecaFrame\'s lastData.dat.'
  }
  if (error instanceof SyntaxError) {
    return language === 'zh-TW'
      ? '檔案內容不是有效的 JSON 或 AlecaFrame inventory。'
      : 'The file is not valid JSON or an AlecaFrame inventory file.'
  }
  return language === 'zh-TW' ? '無法解析這個 inventory 檔案。' : 'Unable to parse this inventory file.'
}

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  const paths: Record<IconName, ReactElement> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9" /><path d="M9 20v-6h6v6" /></>,
    parts: <><path d="m12 3 2.2 4.5L19 9.7l-4.8 2.2L12 16.5l-2.2-4.6L5 9.7l4.8-2.2L12 3Z" /><path d="m19 15 .9 1.9 2.1.9-2.1 1-.9 2.2-.9-2.2-2.1-1 2.1-.9L19 15Z" /></>,
    relics: <><circle cx="12" cy="12" r="8.5" /><path d="M12 6v6l3.5 2" /><path d="M5.7 5.7 4 4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.8 1.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-2.6v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1-1.8-1.8.1-.1A1.7 1.7 0 0 0 8 15a1.7 1.7 0 0 0-1.5-1h-.2v-2.6h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.8-1.8.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h2.6v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.8 1.8-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.5 1Z" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.3 2.3 0 1 1 3.9 1.6c-1.1 1-1.7 1.3-1.7 2.7" /><path d="M12 17h.01" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.7-3.9L4 9" /><path d="M4 4v5h5" /><path d="M4 13a8 8 0 0 0 14.7 3.9L20 15" /><path d="M20 20v-5h-5" /></>,
    external: <><path d="M14 5h5v5" /><path d="m19 5-8 8" /><path d="M19 13v5H6V6h5" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5" /><path d="M12 8h.01" /></>,
  }
  return <svg {...common} aria-hidden="true">{paths[name]}</svg>
}

const navItems: Array<{ label: NavItem; icon: IconName }> = [
  { label: 'Overview', icon: 'home' }, { label: 'Missing parts', icon: 'parts' }, { label: 'Relics', icon: 'relics' }, { label: 'Planner', icon: 'relics' }, { label: 'Prime Resurgence', icon: 'relics' }, { label: 'Void Fissures', icon: 'relics' }, { label: 'Mastery', icon: 'relics' }, { label: 'Settings', icon: 'settings' },
]
const formatDate = (value: string | number | null, language: Language) => value ? new Date(value).toLocaleString(language === 'zh-TW' ? 'zh-TW' : 'en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—'
const capChance = (value: number) => Number(Math.min(100, Math.max(0, value)).toFixed(2))
const getRecommendedRoute = (route: RelicRouteGroup, neededRelicNames: Set<string>) => {
  const rotations = Object.fromEntries(['A', 'B', 'C'].map((label) => {
    const rotation = route.rotations[label as keyof typeof route.rotations]
    if (rotation.chance === null) return [label, rotation]
    const relicDrops = rotation.relicDrops.filter((drop) => neededRelicNames.has(drop.name))
    return [label, { ...rotation, chance: capChance(relicDrops.reduce((sum, drop) => sum + drop.chance, 0)), relicNames: relicDrops.map((drop) => drop.name), relicDrops }]
  })) as RelicRouteGroup['rotations']
  const values = Object.values(rotations).map((rotation) => rotation.chance).filter((chance): chance is number => chance !== null)
  return {
    ...route,
    rotations,
    relicNames: [...new Set(Object.values(rotations).flatMap((rotation) => rotation.relicNames))].sort(),
    averageChance: Number((values.reduce((sum, chance) => sum + chance, 0) / values.length).toFixed(2)),
  }
}
const formatCountdown = (value: string, language: Language) => language === 'zh-TW' ? value.replace('d', '天').replace('h', '小時') : value
const formatRotationTitle = (label: string, language: Language, t: Translation) => language === 'en' ? label : `${t.rotationPrefix}${label.replace(/^Prime Resurgence\s*·?\s*/, '') ? ` · ${label.replace(/^Prime Resurgence\s*·?\s*/, '')}` : ''}`
const localizeEra = (era: string, language: Language, t: Translation) => language === 'zh-TW' ? t.era[era as keyof typeof t.era] ?? era : era
const localizePart = (part: string, language: Language, t: Translation) => language === 'zh-TW' ? t.partNames[part.replace(/\s/g, '') as keyof typeof t.partNames] ?? part : part
const localizePrimeItem = (item: { item: string; itemZh?: string | null }, language: Language) => language === 'zh-TW' ? item.itemZh ?? item.item : item.item
const localizeKind = (kind: 'Warframe' | 'Weapon' | 'Other', t: Translation) => kind === 'Warframe' ? t.warframe : kind === 'Weapon' ? t.weapon : t.other
const localizeRarity = (rarity: 'Common' | 'Uncommon' | 'Rare', language: Language, t: Translation) => language === 'zh-TW' ? t.rarityNames[rarity] : rarity
const localizeRelic = (name: string, language: Language, t: Translation) => { const [era, ...rest] = name.split(' '); return `${localizeEra(era, language, t)} ${rest.join(' ')}` }
const rewardQuantityLabel = (reward: RelicReward) => reward.quantity && reward.quantity > 1 ? ` ×${reward.quantity}` : ''
const localizeReward = (reward: RelicReward, language: Language, t: Translation) => `${localizePrimeItem(reward, language)}${rewardQuantityLabel(reward)} ${localizePart(reward.part, language, t)}`
const localizeSource = (source: string, language: Language) => language === 'zh-TW' ? source.replace('Vaulted relic', '已入庫遺物').replace('check Varzia / Aya (availability follows rotation)', '請確認 Varzia / Aya（依輪替而變）').replace('check Varzia / Aya (availability follows official drop table)', '請確認 Varzia / Aya（依官方掉落表判定）').replace('Official drop source listed outside the mission table', '官方掉落表列出，但不在任務表中').replace('Not listed in the current mission drop table', '目前任務掉落表未列出') : source
const formatChance = (value: number | null) => value === null ? '—' : `${value}%`
type RouteTooltipEntry = { rotation?: string; relic: string; chance: number }
const routeDropEntries = (rotation: RelicRouteGroup['rotations']['A'], language: Language, t: Translation): RouteTooltipEntry[] => rotation.relicDrops.map((drop) => ({ relic: localizeRelic(drop.name, language, t), chance: drop.chance }))
const routeAverageEntries = (route: RelicRouteGroup, language: Language, t: Translation): RouteTooltipEntry[] => ['A', 'B', 'C'].flatMap((label) => route.rotations[label as keyof typeof route.rotations].relicDrops.map((drop) => ({ rotation: `${label} ${language === 'zh-TW' ? '輪' : 'rotation'}`, relic: localizeRelic(drop.name, language, t), chance: drop.chance })))
const localizeSlot = (slot: 'Warframe' | 'Primary' | 'Secondary' | 'Melee' | 'Other', t: Translation) => slot === 'Warframe' ? t.warframe : slot === 'Primary' ? t.primary : slot === 'Secondary' ? t.secondary : slot === 'Melee' ? t.melee : t.other
const formatFissureRemaining = (expiry: string, now: number, language: Language) => {
  const minutes = Math.max(0, Math.floor((new Date(expiry).getTime() - now) / 60_000))
  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60
  if (language === 'zh-TW') return hours > 0 ? `${hours} 小時 ${remainingMinutes} 分` : `${remainingMinutes} 分`
  return hours > 0 ? `${hours}h ${remainingMinutes}m` : `${remainingMinutes}m`
}

const defaultPartImage = '/assets/prime/GenericComponentPrimePlug.png'
const formaImageUrl = '/assets/prime/GenericComponent.png'
function CatalogImage({ src, fallbackSrc, className, alt = '' }: { src?: string | null; fallbackSrc?: string | null; className?: string; alt?: string }) {
  const fallback = fallbackSrc ?? defaultPartImage
  const [currentSrc, setCurrentSrc] = useState(src ?? fallback)
  return <img className={className} src={currentSrc} alt={alt} onError={() => setCurrentSrc((current) => current === fallback ? current : fallback)} />
}
const localizeFissureTier = (tier: string, language: Language, t: Translation) => {
  if (tier.trim().toLowerCase() === 'omnia') return language === 'zh-TW' ? t.fissureOmnia : 'Omnia'
  const [era, ...rest] = tier.split(' ')
  return `${localizeEra(era, language, t)}${rest.length ? ` ${rest.join(' ')}` : ''}`
}
const fissureTierOrder: Record<string, number> = { lith: 0, neo: 1, meso: 2, axi: 3, requiem: 4, omnia: 5 }
const sortFissuresByTier = (missions: FissureMission[]) => [...missions].sort((left, right) => {
  const tierDifference = (fissureTierOrder[left.tier.trim().toLowerCase()] ?? Number.MAX_SAFE_INTEGER) - (fissureTierOrder[right.tier.trim().toLowerCase()] ?? Number.MAX_SAFE_INTEGER)
  return tierDifference || left.node.localeCompare(right.node)
})
const missionTypeOverridesZh: Record<string, string> = {
  Alchemy: '轉化',
  Excavation: '挖掘',
  Hive: '清巢',
  'Infested Salvage': '資源回收',
  'Legacyte Harvest': '基因收割',
  Rush: '突襲',
  Skirmish: '前哨站',
  'The Circuit': '迴路',
  'The Perita Rebellion': '佩里塔叛亂',
  'Void Armageddon': '虛空決戰',
  Volatile: '爆發',
}
const localizeMissionType = (missionType: string, language: Language, t: Translation) => language === 'zh-TW' ? missionTypeOverridesZh[missionType] ?? t.missionTypes[missionType as keyof typeof t.missionTypes] ?? missionType : missionType
// "已入庫" refers to the relic's vaulted status, not the number a player owns.
// Inventory count must never remove an active route that can still supply a missing part.
const filterVaultedRelics = <T extends { isVaulted?: boolean }>(relics: T[], hideVaulted: boolean) => hideVaulted ? relics.filter((relic) => !relic.isVaulted) : relics
const relicEraOrder: Record<string, number> = { Lith: 0, Neo: 1, Meso: 2, Axi: 3 }
const comparePlannerRelics = (left: RelicRoute & { recommendationScore: number }, right: RelicRoute & { recommendationScore: number }) => {
  const eraOrder = (relic: RelicRoute) => relicEraOrder[relic.era] ?? Number.MAX_SAFE_INTEGER
  return eraOrder(left) - eraOrder(right) || right.recommendationScore - left.recommendationScore || left.name.localeCompare(right.name)
}
const rewardRarityOrder: Record<RelicReward['rarity'], number> = { Common: 0, Uncommon: 1, Rare: 2 }
const isAlwaysCompleteReward = (reward: RelicReward) => /^Forma(?:\s+Blueprint)?$/i.test(reward.item.trim())

const partKey = (item: string, part: string) => `${item}::${part}`

function RouteChance({ value, entries, emptyLabel, average = false }: { value: number | null; entries: RouteTooltipEntry[]; emptyLabel: string; average?: boolean }) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null)
  const hasRotation = entries.some((entry) => entry.rotation)
  const showTooltip = (target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    const left = Math.max(12, Math.min(window.innerWidth - 320, rect.left))
    const below = rect.bottom + 8
    setPosition({ left, top: below > window.innerHeight - 150 ? Math.max(12, rect.top - 150) : below })
  }
  return <><span className={`route-chance${average ? ' route-average' : ''}`} tabIndex={0} onMouseEnter={(event) => showTooltip(event.currentTarget)} onMouseLeave={() => setPosition(null)} onFocus={(event) => showTooltip(event.currentTarget)} onBlur={() => setPosition(null)}>{formatChance(value)}</span>{position && createPortal(<span className={`route-tooltip-popover${hasRotation ? ' has-rotation' : ''}`} role="tooltip" style={position}>{entries.length ? entries.map((entry) => <span className="route-tooltip-row" key={`${entry.rotation ?? ''}-${entry.relic}`}>{hasRotation && <small>{entry.rotation}</small>}<span>{entry.relic}</span><strong>{formatChance(entry.chance)}</strong></span>) : <span className="route-tooltip-empty">{emptyLabel}</span>}</span>, document.body)}</>
}

// The part and relic pages must use the same official availability rule.  A
// component is visible only when at least one of its relic sources is visible.
const getVisibleParts = (data: DashboardData, hideVaulted: boolean) => {
  const visibleRewardKeys = new Set(
    filterVaultedRelics(data.relics, hideVaulted)
      .flatMap((relic) => relic.rewards)
      .map((reward) => partKey(reward.item, reward.part)),
  )
  return data.parts.filter((part) => visibleRewardKeys.has(partKey(part.item, part.part)))
}
const getVisibleMissingParts = (data: DashboardData, hideVaulted: boolean) => {
  const visiblePartKeys = new Set(getVisibleParts(data, hideVaulted).map((part) => partKey(part.item, part.part)))
  return data.missing.filter((part) => visiblePartKeys.has(partKey(part.item, part.part)))
}

const localizeMasteryCategory = (item: MasteryEquipment, t: Translation) => item.slot === 'Warframe' ? t.warframe : item.slot === 'Primary' ? t.primary : item.slot === 'Secondary' ? t.secondary : item.slot === 'Melee' ? t.melee : item.category
const localizeMasteryName = (item: MasteryEquipment, language: Language) => language === 'zh-TW' ? item.nameZh ?? item.name : item.name
const localizeMasteryComponentName = (component: MasteryComponent, language: Language, t: Translation) => language === 'zh-TW' ? component.nameZh ?? t.partNames[component.name.replace(/\s/g, '') as keyof typeof t.partNames] ?? component.name : component.name
const formatMasteryXp = (xp: number) => xp.toLocaleString('en-US')
const masteryStatus = (item: DashboardData['masteryItems'][number]) => item.mastered ? 'mastered' : item.owned ? 'owned' : 'missing'
const masteryDropTooltip = (item: DashboardData['masteryItems'][number], component: MasteryComponent, data: DashboardData, t: Translation, language: Language) => {
  const lines = [`${localizeMasteryComponentName(component, language, t)}${component.quantity > 1 ? ` ×${component.quantity}` : ''}`, t.masteryDropTitle]
  const primePart = data.parts.find((part) => part.item === item.name && part.part === component.name)
  if (primePart) {
    const relic = data.relics.find((route) => route.name === primePart.bestRelic)
    const reward = relic?.rewards.find((entry) => entry.item === primePart.item && entry.part === primePart.part)
    for (const location of (relic?.locations ?? []).slice(0, 6)) {
      lines.push(`${location.label} · ${t.masteryRotation} ${location.rotation ?? '—'} · ${t.masteryRelicChance} ${location.chance}% · ${t.masteryPartChance} ${reward?.chance ?? '—'}%`)
    }
  }
  for (const drop of component.drops.slice(0, 6)) lines.push(`${drop.location} · ${t.masteryRotation} ${drop.rotation ?? '—'} · ${drop.chance}%`)
  if (lines.length === 2) lines.push(t.masteryDropNone)
  return lines.join('\n')
}

function MasteryPage({ data, t, language }: { data: DashboardData; t: Translation; language: Language }) {
  const [query, setQuery] = useState('')
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(() => new Set(['missing', 'owned', 'mastered']))
  const statuses = [{ key: 'missing', label: t.masteryMissing }, { key: 'owned', label: t.masteryOwned }, { key: 'mastered', label: t.masteryMastered }]
  const rows = useMemo(() => data.masteryItems.filter((item) => selectedStatuses.has(masteryStatus(item)) && (!query.trim() || `${item.name} ${item.nameZh ?? ''} ${item.category} ${item.productCategory}`.toLowerCase().includes(query.trim().toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)), [data.masteryItems, query, selectedStatuses])
  return <><div className="page-heading page-heading-row"><div><h1>{t.masteryTitle}</h1><p>{t.masteryDescription}</p></div><span className="page-count">{t.masteryShowing(rows.length)}</span></div><div className="toolbar mastery-toolbar"><label className="search-box"><span>{t.masterySearch}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.masterySearchPlaceholder} /></label><div className="mastery-filters" role="group" aria-label={t.masteryFilters}>{statuses.map((status) => <label className="filter-check" key={status.key}><input type="checkbox" checked={selectedStatuses.has(status.key)} onChange={(event) => setSelectedStatuses((current) => { const next = new Set(current); if (event.target.checked) next.add(status.key); else next.delete(status.key); return next })} /><span>{status.label}</span></label>)}</div></div><section className="panel mastery-panel"><div className="table-head mastery-grid"><span>{t.item}</span><span>{t.type}</span><span>{t.masteryStatus}</span><span>{t.masteryComponents}</span><span>{t.masteryMasteryRank}</span></div><div className="table-body table-scroll">{rows.map((item) => <article className="table-row mastery-grid mastery-row" key={item.id}><span className="mastery-item-cell"><img className="item-thumb mastery-thumb" src={item.imageUrl ?? '/assets/prime/OmegaIsotope.png'} alt="" /><span className="item-copy"><strong>{localizeMasteryName(item, language)}</strong><small>{localizeMasteryCategory(item, t)}{item.isPrime ? ` · ${item.owned ? t.masteryPrimeOwned : t.masteryPrime}` : ''}</small></span></span><span>{localizeMasteryCategory(item, t)}</span><span className={`status-pill ${masteryStatus(item)}`}>{item.mastered ? t.masteryMastered : item.owned ? `${t.masteryOwned} · ${t.masteryXp} ${formatMasteryXp(item.xp)}` : t.masteryMissing}</span><span className="mastery-components">{item.missingComponents.length ? item.missingComponents.map((component, componentIndex) => <span className="mastery-component" key={`${item.id}-${component.uniqueName}-${componentIndex}`} title={masteryDropTooltip(item, component, data, t, language)}>{localizeMasteryComponentName(component, language, t)}{component.quantity > 1 ? ` ×${component.quantity}` : ''}</span>) : <span className="mastery-no-components">{item.owned ? '—' : t.masteryNoComponents}</span>}</span><span>MR {item.masteryReq}</span></article>)}{rows.length === 0 && <div className="empty-state">{t.masteryNoResults}</div>}</div></section></>
}

function VoidFissuresPage({ fissures, loading, error, t, language, selectedMissionTypes }: { fissures: FissureMission[]; loading: boolean; error: string; t: Translation; language: Language; selectedMissionTypes: Set<string> }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(interval)
  }, [])
  const visible = useMemo(() => fissures.filter((mission) => selectedMissionTypes.has(mission.missionTypeKey ?? mission.missionType)), [fissures, selectedMissionTypes])
  const columns = [
    { key: 'normal', title: t.fissureNormal, missions: sortFissuresByTier(visible.filter((mission) => !mission.isStorm && !mission.isHard)) },
    { key: 'steel', title: t.fissureSteelPath, missions: sortFissuresByTier(visible.filter((mission) => !mission.isStorm && mission.isHard)) },
    { key: 'storm', title: t.fissureStorms, missions: sortFissuresByTier(visible.filter((mission) => mission.isStorm)) },
  ]
  return <><div className="page-heading page-heading-row"><div><h1>{t.fissuresTitle}</h1><p>{t.fissuresDescription}</p></div><span className="page-count">{visible.length} / {fissures.length}</span></div>{loading && <div className="section-placeholder fissure-placeholder"><div><span className="placeholder-icon"><Icon name="refresh" size={28} /></span><h2>{t.fissureLoading}</h2></div></div>}{error && !loading && <div className="error-banner"><Icon name="info" /> {t.fissureError} <span className="fissure-error-detail">{error}</span></div>}{!loading && <div className="fissure-columns">{columns.map((column) => <section className="panel fissure-column" key={column.key}><div className="fissure-column-head"><h2>{column.title}</h2><em>{t.fissureMissionCount(column.missions.length)}</em></div><div className="fissure-list">{column.missions.map((mission) => <article className="fissure-card" key={mission.id}><div className="fissure-card-head"><strong>{localizeFissureTier(mission.tier, language, t)} / {localizeMissionType(mission.missionTypeKey ?? mission.missionType, language, t)}</strong></div><div className="fissure-card-meta"><small className="fissure-node">{mission.node}</small><span>{mission.enemy}</span></div><div className="fissure-card-footer"><span>{t.fissureExpires}</span><strong>{formatFissureRemaining(mission.expiry, now, language)}</strong></div></article>)}{column.missions.length === 0 && <div className="empty-state">{t.fissureEmpty}</div>}</div></section>)}</div>}</>
}

function PartsPage({ data, t, language, hideOwnedRelics }: { data: DashboardData; t: Translation; language: Language; hideOwnedRelics: boolean }) {
  const [query, setQuery] = useState('')
  const [hideOwned, setHideOwned] = useState(true)
  const visibleParts = useMemo(() => getVisibleParts(data, hideOwnedRelics), [data, hideOwnedRelics])
  const missingParts = useMemo(() => getVisibleMissingParts(data, hideOwnedRelics), [data, hideOwnedRelics])
  const parts = useMemo(() => visibleParts.filter((part) => (!hideOwned || part.owned < 1) && (!query.trim() || `${part.item} ${part.part}`.toLowerCase().includes(query.trim().toLowerCase()))), [visibleParts, query, hideOwned])
  return <><div className="page-heading page-heading-row"><div><h1>{t.missingTitle}</h1><p>{t.missingDescription(missingParts.length, visibleParts.length)}</p></div><span className="page-count">{missingParts.length} {t.missing}</span></div><div className="toolbar"><label className="search-box"><span>{t.searchParts}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPartsPlaceholder} /></label><label className="filter-check"><input type="checkbox" checked={hideOwned} onChange={(event) => setHideOwned(event.target.checked)} /><span>{t.hideOwnedParts}</span></label><span className="toolbar-note">{t.showingParts(parts.length)}</span></div><section className="panel table-panel"><div className="table-head parts-full-grid"><span>{t.item}</span><span>{t.part}</span><span>{t.status}</span><span>{t.rarity}</span><span>{t.bestRelic}</span></div><div className="table-body table-scroll">{parts.map((part) => <div className="table-row parts-full-grid" key={part.id}><ItemThumb part={part} t={t} language={language} /><span>{localizePart(part.part, language, t)}</span><span className={`status-pill ${part.owned > 0 ? 'owned' : 'missing'}`}>{part.owned > 0 ? `${t.owned} ×${part.owned}` : t.missing}</span><span className={`rarity ${part.rarity.toLowerCase()}`}><span className="rarity-gem" />{localizeRarity(part.rarity, language, t)}</span><span>{localizeRelic(part.bestRelic, language, t)}</span></div>)}{parts.length === 0 && <div className="empty-state">{t.noResults(query)}</div>}</div></section></>
}

function ItemThumb({ part, t, language }: { part: DashboardData['parts'][number] | DashboardData['missing'][number]; t: Translation; language?: Language }) {
  const displayLanguage = language ?? (t.partNames.Blueprint === 'Blueprint' ? 'en' : 'zh-TW')
  return <span className="item-cell">{part.imageUrl ? <CatalogImage className="item-thumb" src={part.imageUrl} fallbackSrc={part.itemImageUrl} /> : <span className={`item-glyph ${part.rarity.toLowerCase()}`}>{part.item.slice(0, 1)}</span>}<span className="item-copy"><span>{localizePrimeItem(part, displayLanguage)}</span><small>{localizePart(part.part, displayLanguage, t)} · {localizeKind(part.kind, t)}</small></span></span>
}

function RelicsPage({ data, t, language, hideOwnedRelics, selectedMissionTypes }: { data: DashboardData; t: Translation; language: Language; hideOwnedRelics: boolean; selectedMissionTypes: Set<string> }) {
  const [query, setQuery] = useState('')
  const visibleRelicNames = useMemo(() => new Set(filterVaultedRelics(data.unownedRelics, hideOwnedRelics).map((relic) => relic.name)), [data.unownedRelics, hideOwnedRelics])
  const routes = useMemo(() => data.routeGroups.map((route) => getRecommendedRoute(route, visibleRelicNames)).filter((route) => selectedMissionTypes.has(route.gameMode) && route.relicNames.length > 0 && (!query.trim() || `${route.gameMode} ${route.faction} ${route.missions.join(' ')} ${route.relicNames.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))).sort((left, right) => right.averageChance - left.averageChance), [data.routeGroups, visibleRelicNames, query, selectedMissionTypes])
  return <><div className="page-heading page-heading-row"><div><h1>{t.relicTitle}</h1><p>{t.relicDescription}</p></div><span className="page-count">{routes.length} {t.routes}</span></div><div className="toolbar"><label className="search-box"><span>{t.searchRelics}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchRelicsPlaceholder} /></label><span className="toolbar-note">{t.showingRoutes(routes.length)} · {t.routeMissionsHint}</span></div><section className="panel table-panel route-panel"><div className="table-head route-grid"><span>{t.routeMode}</span><span>{t.faction}</span><span>{t.rotationA}</span><span>{t.rotationB}</span><span>{t.rotationC}</span><span>{t.average}</span></div><div className="table-body table-scroll">{routes.map((route) => <div className="table-row route-grid route-row" key={route.id} title={`${t.matchedStages}:\n${route.missions.join('\n')}`}><span className="route-mode"><strong>{localizeMissionType(route.gameMode, language, t)}</strong><small>{route.missions.length} {t.matchedStages}</small><span className="route-mission-list">{route.missions.join(' · ')}</span></span><span>{route.faction}</span><RouteChance value={route.rotations.A.chance} entries={routeDropEntries(route.rotations.A, language, t)} emptyLabel={t.noNeededRelics} /><RouteChance value={route.rotations.B.chance} entries={routeDropEntries(route.rotations.B, language, t)} emptyLabel={t.noNeededRelics} /><RouteChance value={route.rotations.C.chance} entries={routeDropEntries(route.rotations.C, language, t)} emptyLabel={t.noNeededRelics} /><RouteChance value={route.averageChance} entries={routeAverageEntries(route, language, t)} emptyLabel={t.noNeededRelics} average /></div>)}{routes.length === 0 && <div className="empty-state">{t.noResults(query)}</div>}</div></section></>
}

function PlannerPage({ data, t, language, hideOwnedRelics }: { data: DashboardData; t: Translation; language: Language; hideOwnedRelics: boolean }) {
  const [hideOwnedRewards, setHideOwnedRewards] = useState(false)
  const rows = useMemo(() => [...filterVaultedRelics(data.unownedRelics, hideOwnedRelics)].sort(comparePlannerRelics), [data.unownedRelics, hideOwnedRelics])
  const partByKey = useMemo(() => new Map(data.parts.map((part) => [`${part.item}::${part.part}`, part])), [data.parts])
  return <><div className="page-heading page-heading-row"><div><h1>{t.plannerTitle}</h1><p>{t.plannerDescription}</p></div><span className="page-count">{t.plannerRows(rows.length)}</span></div><div className="toolbar planner-toolbar"><label className="filter-check"><input type="checkbox" checked={hideOwnedRewards} onChange={(event) => setHideOwnedRewards(event.target.checked)} /><span>{t.hideOwnedRewards}</span></label></div><section className="panel relic-list-panel"><div className="relic-list">{rows.map((route) => {
    const bestLocation = route.locations.reduce<(typeof route.locations)[number] | undefined>((best, location) => !best || location.chance > best.chance ? location : best, undefined)
    const rewards = [...route.rewards].sort((left, right) => rewardRarityOrder[left.rarity] - rewardRarityOrder[right.rarity])
    const visibleRewards = hideOwnedRewards ? rewards.filter((reward) => !isAlwaysCompleteReward(reward) && (partByKey.get(`${reward.item}::${reward.part}`)?.owned ?? 0) < 1) : rewards
    return <article className="relic-card" key={route.name}><div className="relic-card-head"><CatalogImage className="relic-card-thumb" src={route.imageUrl} fallbackSrc="/assets/prime/OmegaIsotope.png" /><div><strong>{localizeRelic(route.name, language, t)}</strong><small>{route.owned ? `${route.owned}×` : '0×'} · {localizeEra(route.era, language, t)}</small></div></div><div className="relic-rewards">{visibleRewards.map((reward) => { const part = partByKey.get(`${reward.item}::${reward.part}`); const alwaysComplete = isAlwaysCompleteReward(reward); const owned = alwaysComplete || (part?.owned ?? 0) > 0; const rewardImageUrl = part?.imageUrl ?? reward.imageUrl ?? (alwaysComplete ? formaImageUrl : null); return <div className={`relic-reward ${owned ? 'owned' : 'missing'} ${reward.rarity.toLowerCase()}`} key={`${route.name}-${reward.item}-${reward.part}`} title={`${localizeReward(reward, language, t)} · ${reward.chance}%`}><span className="reward-image-wrap">{rewardImageUrl ? <CatalogImage src={rewardImageUrl} fallbackSrc={part?.itemImageUrl} /> : <span className="item-glyph">?</span>}{owned && <span className="reward-check">✓</span>}</span><span className="reward-copy"><strong>{localizePrimeItem(reward, language)}{rewardQuantityLabel(reward)}</strong><small>{localizePart(reward.part, language, t)}</small></span></div> })}</div>{bestLocation && <div className="relic-card-route"><span>{language === 'zh-TW' ? '最高效地圖' : 'Best mission'}</span><strong>{bestLocation.mission}</strong><small>{localizeMissionType(bestLocation.gameMode, language, t)}{bestLocation.rotation ? ` · ${bestLocation.rotation}${language === 'zh-TW' ? ' 輪' : ''}` : ''} · {formatChance(bestLocation.chance)}</small></div>}</article>
  })}{rows.length === 0 && <div className="empty-state">{t.noPlannerResults}</div>}</div></section></>
}

function PrimeResurgencePage({ data, t, language }: { data: DashboardData; t: Translation; language: Language }) {
  const currentItems = useMemo(() => data.rotation.featuredItems.map((item) => data.parts.find((part) => part.item === item)).filter(Boolean).filter((part, index, array) => array.findIndex((candidate) => candidate?.item === part?.item) === index) as DashboardData['parts'], [data.parts, data.rotation.featuredItems])
  const grouped = useMemo(() => ({
    Warframe: currentItems.filter((part) => part.slot === 'Warframe'),
    Primary: currentItems.filter((part) => part.slot === 'Primary'),
    Secondary: currentItems.filter((part) => part.slot === 'Secondary'),
    Melee: currentItems.filter((part) => part.slot === 'Melee'),
  }), [currentItems])
  const rowCount = Math.max(2, grouped.Warframe.length, grouped.Primary.length, grouped.Secondary.length, grouped.Melee.length)
  const itemCard = (part: DashboardData['parts'][number] | undefined, slot: 'Warframe' | 'Primary' | 'Secondary' | 'Melee') => part ? <div className="rotation-item"><CatalogImage src={part.itemImageUrl} fallbackSrc={part.imageUrl} /><div><strong>{part.item}</strong><small>{localizeSlot(slot, t)}</small></div><span className={data.parts.filter((candidate) => candidate.item === part.item && candidate.owned > 0).length === data.parts.filter((candidate) => candidate.item === part.item).length ? 'rotation-owned' : 'rotation-missing'}>{data.parts.filter((candidate) => candidate.item === part.item && candidate.owned > 0).length === data.parts.filter((candidate) => candidate.item === part.item).length ? '✓' : t.missingCount(data.parts.filter((candidate) => candidate.item === part.item && candidate.owned < 1).length)}</span></div> : <div className="rotation-item empty"><span>—</span></div>
  return <><div className="page-heading page-heading-row"><h1>{t.resurgenceTitle}</h1><span className="page-count">{t.resetsIn} {formatCountdown(data.rotation.resetsIn, language)}</span></div><section className="panel rotation-panel"><div className="panel-heading"><h2>{t.rotationItems} <em>{data.rotation.featuredItems.length}</em></h2></div><div className="rotation-grid">{Array.from({ length: rowCount }, (_, index) => <div className="rotation-row" key={index}>{itemCard(grouped.Warframe[index], 'Warframe')}{itemCard(grouped.Primary[index], 'Primary')}{itemCard(grouped.Secondary[index], 'Secondary')}{itemCard(grouped.Melee[index], 'Melee')}</div>)}</div></section><section className="panel table-panel rotation-missing-panel"><div className="panel-heading"><h2>{t.rotationMissing} <em>{currentItems.reduce((sum, item) => sum + data.parts.filter((part) => part.item === item.item && part.owned < 1).length, 0)}</em></h2></div><div className="table-head parts-full-grid"><span>{t.item}</span><span>{t.part}</span><span>{t.status}</span><span>{t.rarity}</span><span>{t.bestRelic}</span></div><div className="table-body table-scroll">{currentItems.flatMap((item) => data.parts.filter((part) => part.item === item.item && part.owned < 1)).map((part) => <div className="table-row parts-full-grid" key={part.id}><ItemThumb part={part} t={t} language={language} /><span>{localizePart(part.part, language, t)}</span><span className="status-pill missing">{t.missing}</span><span className={`rarity ${part.rarity.toLowerCase()}`}><span className="rarity-gem" />{localizeRarity(part.rarity, language, t)}</span><span>{localizeRelic(part.bestRelic, language, t)}</span></div>)}</div></section></>
}

function SettingsPage({ data, t, language, onImport, onReset, onLanguageChange, hideOwnedRelics, onHideOwnedRelicsChange, missionTypes, selectedMissionTypes, onMissionTypeChange, fileSource, lastCheckedAt }: { data: DashboardData; t: Translation; language: Language; onImport: () => void; onReset: () => void; onLanguageChange: (language: Language) => void; hideOwnedRelics: boolean; onHideOwnedRelicsChange: (value: boolean) => void; missionTypes: string[]; selectedMissionTypes: Set<string>; onMissionTypeChange: (type: string, enabled: boolean) => void; fileSource?: FileSource; lastCheckedAt?: number }) {
  return <><div className="page-heading"><h1>{t.settingsTitle}</h1><p>{t.settingsDescription}</p></div><section className="panel language-panel"><div><span className="card-kicker">LANGUAGE</span><h2>{t.language}</h2></div><div className="language-switch" role="group" aria-label={t.language}><button className={language === 'zh-TW' ? 'selected' : ''} onClick={() => onLanguageChange('zh-TW')}>{t.traditionalChinese}</button><button className={language === 'en' ? 'selected' : ''} onClick={() => onLanguageChange('en')}>{t.english}</button></div></section><section className="panel settings-option"><div className="settings-option-copy"><span className="card-kicker">{t.relic}</span><h2>{t.hideOwnedRelics}</h2><p>{t.hideOwnedRelicsDescription}</p></div><label className="filter-check"><input type="checkbox" checked={hideOwnedRelics} onChange={(event) => onHideOwnedRelicsChange(event.target.checked)} /><span>{t.hideOwnedRelics}</span></label></section><section className="panel settings-mission-types"><div className="settings-option-copy"><span className="card-kicker">FILTER</span><h2>{t.missionTypeFilter}</h2><p>{t.missionTypeFilterDescription}</p></div><div className="settings-mission-type-list" role="group" aria-label={t.missionTypeFilter}>{missionTypes.map((type) => <label className="filter-check" key={type}><input type="checkbox" checked={selectedMissionTypes.has(type)} onChange={(event) => onMissionTypeChange(type, event.target.checked)} /><span>{localizeMissionType(type, language, t)}</span></label>)}</div></section><div className="data-card-grid"><section className="data-card"><span className="card-kicker">{t.inventoryCard}</span><h2>{data.imported ? t.alecaLoaded : t.noInventory}</h2><p>{data.imported ? t.alecaLoadedDescription : t.noInventoryDescription}</p><button className="button button-secondary" onClick={onImport}><Icon name="upload" /> {t.importInventory}</button><p className="data-note">{fileSource ? `${t.fileSource}: ${fileSource.name} · ${t.fileLastChecked}: ${lastCheckedAt ? formatDate(lastCheckedAt, language) : '—'} · ${fileSource.persisted ? t.autoRefresh : t.manualImportOnly}` : t.noFileSource}</p></section><section className="data-card"><span className="card-kicker">{t.catalogCard}</span><h2>{t.rotationData}</h2><p>{t.catalogDescription(data.parts.length, data.relics.length, formatDate(data.catalogUpdatedAt, language))}</p><code>{t.updateCommand}</code></section><section className="data-card"><span className="card-kicker">{t.privacyCard}</span><h2>{t.privacyCardTitle}</h2><p>{t.privacyDescription}</p><span className="local-status"><span className="status-dot" /> {t.ready}</span></section></div><section className="panel settings-panel"><div className="panel-heading"><h2>{t.resetTitle}</h2></div><div className="settings-row"><div><strong>{t.clearInventory}</strong><p>{t.clearDescription}</p></div><button className="button button-outline" onClick={onReset}>{t.reset}</button></div></section></>
}

function App() {
  const fileInput = useRef<HTMLInputElement>(null)
  const fileHandleRef = useRef<PersistentFileHandle | undefined>(undefined)
  const localSourceRef = useRef(false)
  const fileSourceRef = useRef<FileSource | undefined>(undefined)
  const checkingFileRef = useRef(false)
  const [data, setData] = useState<DashboardData>(() => analyzeInventory())
  const [rawInventory, setRawInventory] = useState<unknown>()
  const [active, setActive] = useState<NavItem>('Overview')
  const [error, setError] = useState('')
  const [language, setLanguage] = useState<Language>(() => typeof window !== 'undefined' && window.localStorage.getItem('relic-ledger-language') === 'en' ? 'en' : 'zh-TW')
  // Match Aleca's Planner default: Vaulted = No. Keep an explicit user choice
  // to turn the filter off, while new sessions start with vaulted relics hidden.
  const [hideOwnedRelics, setHideOwnedRelics] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem('relic-ledger-hide-owned-relics') !== 'false')
  const [fileSource, setFileSource] = useState<FileSource>()
  const [lastCheckedAt, setLastCheckedAt] = useState<number>()
  const [fissures, setFissures] = useState<FissureMission[]>([])
  const fissuresRef = useRef<FissureMission[]>([])
  const knownMissionTypesRef = useRef<Set<string>>(new Set())
  const [selectedMissionTypes, setSelectedMissionTypes] = useState<Set<string>>(() => new Set())
  const [fissureLoading, setFissureLoading] = useState(true)
  const [fissureError, setFissureError] = useState('')
  const missionTypes = useMemo(() => Array.from(new Set([
    ...data.routeGroups.map((route) => route.gameMode),
    ...fissures.map((mission) => mission.missionTypeKey ?? mission.missionType),
  ])).sort((a, b) => a.localeCompare(b)), [data.routeGroups, fissures])
  const t = translations[language]
  const changeLanguage = (next: Language) => { setLanguage(next); window.localStorage.setItem('relic-ledger-language', next) }
  useEffect(() => {
    const previousTypes = knownMissionTypesRef.current
    const addedTypes = missionTypes.filter((type) => !previousTypes.has(type))
    knownMissionTypesRef.current = new Set(missionTypes)
    if (addedTypes.length === 0) return
    setSelectedMissionTypes((current) => new Set([...current, ...addedTypes]))
  }, [missionTypes])
  const parseImportedFile = async (file: File) => file.name.toLowerCase().endsWith('.json') ? parseInventoryJson(await file.text()) : parseAlecaFrameFile(file)
  const importFile = async (file?: File, handle?: PersistentFileHandle, localSource = false) => {
    if (!file) return
    setError('')
    try {
      const inventory = await parseImportedFile(file)
      let persisted = false
      if (handle) {
        try {
          await saveInventoryHandle(handle)
          fileHandleRef.current = handle
          persisted = true
        } catch {
          fileHandleRef.current = undefined
        }
        localSourceRef.current = false
      } else if (localSource) {
        fileHandleRef.current = undefined
        localSourceRef.current = true
      } else {
        fileHandleRef.current = undefined
        localSourceRef.current = false
        void clearInventoryHandle()
      }
      const nextFileSource: FileSource = {
        kind: localSource ? 'local-alecaframe' : 'file',
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        persisted: persisted || localSource,
      }
      try {
        await saveInventorySnapshot(createInventorySnapshot(inventory, nextFileSource))
      } catch {
        // The import itself remains usable when IndexedDB is unavailable.
      }
      setRawInventory(inventory)
      setData(analyzeInventory(inventory))
      fileSourceRef.current = nextFileSource
      setFileSource(nextFileSource)
      setLastCheckedAt(Date.now())
    } catch (err) {
      setError(getImportErrorMessage(err, language))
    }
  }
  const getLocalInventoryFile = async () => {
    const hostname = window.location.hostname
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') return undefined
    try {
      const response = await fetch('/api/local-inventory', { cache: 'no-store' })
      if (response.status === 404) return undefined
      if (!response.ok) throw new Error('Local AlecaFrame inventory endpoint failed.')
      if (!response.headers.get('Content-Type')?.includes('application/octet-stream')) return undefined
      const contents = await response.blob()
      const lastModified = Number(response.headers.get('X-Inventory-Last-Modified')) || Date.now()
      const name = response.headers.get('X-Inventory-Name') || 'lastData.dat'
      return new File([contents], name, { type: 'application/octet-stream', lastModified })
    } catch {
      return undefined
    }
  }
  const refreshFromLocalEndpoint = async (silent = true, force = false) => {
    if (checkingFileRef.current) return
    checkingFileRef.current = true
    try {
      const file = await getLocalInventoryFile()
      if (!file) return
      setLastCheckedAt(Date.now())
       const currentSource = fileSourceRef.current
       if (force || !currentSource || currentSource.lastModified !== file.lastModified || currentSource.size !== file.size) {
        await importFile(file, undefined, true)
      }
    } catch (err) {
      if (!silent) setError(getImportErrorMessage(err, language))
    } finally {
      checkingFileRef.current = false
    }
  }
  const refreshFromHandle = async (handle: PersistentFileHandle, silent = true, force = false) => {
    if (checkingFileRef.current) return
    checkingFileRef.current = true
    try {
      const permission = await handle.queryPermission?.({ mode: 'read' })
      if (permission && permission !== 'granted') {
        if (!silent) setError(language === 'zh-TW' ? '需要重新授權讀取已保存的 inventory 檔案。' : 'Permission is required to read the saved inventory file again.')
        return
      }
      const file = await handle.getFile()
      setLastCheckedAt(Date.now())
       const currentSource = fileSourceRef.current
       if (force || !currentSource || currentSource.lastModified !== file.lastModified || currentSource.size !== file.size) {
        await importFile(file, handle)
      }
    } catch (err) {
      if (!silent) setError(getImportErrorMessage(err, language))
    } finally {
      checkingFileRef.current = false
    }
  }
  useEffect(() => {
    let cancelled = false
    const restoreInventory = async () => {
      const snapshot = await loadInventorySnapshot()
      const needsMasteryMigration = snapshot?.masteryProgress === undefined || snapshot?.pendingRecipes === undefined
      if (snapshot && !cancelled) {
        const cachedSource: FileSource = { ...snapshot.source, persisted: snapshot.source.kind === 'local-alecaframe' }
        fileSourceRef.current = cachedSource
        setFileSource(cachedSource)
        setLastCheckedAt(snapshot.importedAt)
        setRawInventory(snapshot)
        setData(analyzeInventorySnapshot(snapshot))
      }
      const handle = await loadInventoryHandle()
      if (cancelled) return
      if (handle) {
        fileHandleRef.current = handle
        localSourceRef.current = false
        await refreshFromHandle(handle, false, needsMasteryMigration)
      } else if (snapshot?.source.kind === 'local-alecaframe' || !snapshot) {
        await refreshFromLocalEndpoint(false, needsMasteryMigration)
      }
    }
    void restoreInventory().catch((err) => {
      if (!cancelled) setError(getImportErrorMessage(err, language))
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    const handle = fileHandleRef.current
    if (localSourceRef.current && fileSource?.persisted) {
      const interval = window.setInterval(() => { void refreshFromLocalEndpoint() }, 60_000)
      return () => window.clearInterval(interval)
    }
    if (!handle || !fileSource?.persisted) return
    const interval = window.setInterval(() => { void refreshFromHandle(handle) }, 60_000)
    return () => window.clearInterval(interval)
  }, [fileSource?.name, fileSource?.persisted])
  useEffect(() => {
    let cancelled = false
    let expiryTimer: number | undefined
    const scheduleExpiryRefresh = () => {
      if (expiryTimer) window.clearTimeout(expiryTimer)
      const nextExpiry = fissuresRef.current.map((mission) => new Date(mission.expiry).getTime()).filter((value) => Number.isFinite(value) && value > Date.now()).sort((a, b) => a - b)[0]
      if (!nextExpiry) return
      expiryTimer = window.setTimeout(() => { void loadFissures() }, Math.max(1_000, nextExpiry - Date.now() + 1_000))
    }
    const loadFissures = async () => {
      try {
        const response = await fetch('/api/fissures', { cache: 'no-store' })
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const payload = await response.json() as unknown
        if (!Array.isArray(payload)) throw new Error('Invalid fissure response')
        if (!cancelled) {
          const nextFissures = payload as FissureMission[]
          fissuresRef.current = nextFissures
          setFissures(nextFissures)
          setFissureError('')
          scheduleExpiryRefresh()
        }
      } catch (err) {
        if (!cancelled && fissuresRef.current.length === 0) setFissureError(err instanceof Error ? err.message : 'Unable to load fissures')
      } finally {
        if (!cancelled) setFissureLoading(false)
      }
    }
    void loadFissures()
    const interval = window.setInterval(() => void loadFissures(), 60_000)
    return () => { cancelled = true; window.clearInterval(interval); if (expiryTimer) window.clearTimeout(expiryTimer) }
  }, [])
  const setHideOwned = (next: boolean) => { setHideOwnedRelics(next); window.localStorage.setItem('relic-ledger-hide-owned-relics', String(next)) }
  const setMissionTypeEnabled = (type: string, enabled: boolean) => setSelectedMissionTypes((current) => {
    const next = new Set(current)
    if (enabled) next.add(type)
    else next.delete(type)
    return next
  })
  const openImport = () => {
    // Use the regular input picker so Windows system folders such as AppData
    // do not block the advanced File System Access picker.
    fileInput.current?.click()
  }
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => { const file = event.target.files?.[0]; event.currentTarget.value = ''; void importFile(file) }
  const resetInventory = () => {
    fileHandleRef.current = undefined
    fileSourceRef.current = undefined
    localSourceRef.current = false
    void clearInventoryHandle()
    void clearInventorySnapshot()
    setFileSource(undefined)
    setLastCheckedAt(undefined)
    setRawInventory(undefined)
    setError('')
    setData(analyzeInventory())
  }
  return <div className="app-shell"><aside className="sidebar"><div className="brand"><div className="brand-mark">◇</div><span>Relic Ledger</span></div><nav className="nav-list" aria-label="Main menu">{navItems.map(({ label, icon }) => <button key={label} aria-label={t.nav[label]} className={`nav-item ${active === label ? 'active' : ''}`} onClick={() => setActive(label)}><Icon name={icon} /><span>{t.nav[label]}</span></button>)}</nav>{!data.imported && <div className="side-import"><h3>{t.noInventory}</h3><p>{t.importHint}</p><button className="button button-secondary full" onClick={() => void openImport()}><Icon name="upload" /> {t.importInventory}</button></div>}</aside><main className="main-content"><header className="topbar"><div className="sync-meta"><span className="local-status"><span className="status-dot" /> {t.localOnly}</span><span className="divider" /><span>{t.lastSync}: {lastCheckedAt ? formatDate(lastCheckedAt, language) : t.demoData}</span><button className="icon-button" title={t.recalculate} onClick={() => { setData(analyzeInventory(rawInventory)); setLastCheckedAt(Date.now()) }}><Icon name="refresh" size={17} /></button></div><div className="top-actions">{data.imported && fileSource ? <span className="data-updated-at">{t.dataUpdated}: {formatDate(fileSource.lastModified, language)}</span> : <button className="button button-primary" onClick={() => void openImport()}><Icon name="upload" /> {t.importInventory}</button>}<button className="icon-button help" title={t.openSettings} onClick={() => setActive('Settings')}><Icon name="help" /></button></div></header><input ref={fileInput} className="hidden-input" type="file" accept=".dat,.json,application/json,application/octet-stream" onChange={handleInputChange} /><section className="content-wrap">{error && <div className="error-banner"><Icon name="info" /> {error}</div>}{active === 'Overview' && <Overview data={data} t={t} language={language} onNavigate={setActive} hideOwnedRelics={hideOwnedRelics} selectedMissionTypes={selectedMissionTypes} />}{active === 'Missing parts' && <PartsPage data={data} t={t} language={language} hideOwnedRelics={hideOwnedRelics} />}{active === 'Relics' && <RelicsPage data={data} t={t} language={language} hideOwnedRelics={hideOwnedRelics} selectedMissionTypes={selectedMissionTypes} />}{active === 'Planner' && <PlannerPage data={data} t={t} language={language} hideOwnedRelics={hideOwnedRelics} />}{active === 'Prime Resurgence' && <PrimeResurgencePage data={data} t={t} language={language} />}{active === 'Void Fissures' && <VoidFissuresPage fissures={fissures} loading={fissureLoading} error={fissureError} t={t} language={language} selectedMissionTypes={selectedMissionTypes} />}{active === 'Mastery' && <MasteryPage data={data} t={t} language={language} />}{active === 'Settings' && <SettingsPage data={data} t={t} language={language} onImport={() => void openImport()} onReset={resetInventory} onLanguageChange={changeLanguage} hideOwnedRelics={hideOwnedRelics} onHideOwnedRelicsChange={setHideOwned} missionTypes={missionTypes} selectedMissionTypes={selectedMissionTypes} onMissionTypeChange={setMissionTypeEnabled} fileSource={fileSource} lastCheckedAt={lastCheckedAt} />}</section></main></div>
}

function Overview({ data, t, language, onNavigate, hideOwnedRelics, selectedMissionTypes }: { data: DashboardData; t: Translation; language: Language; onNavigate: (page: NavItem) => void; hideOwnedRelics: boolean; selectedMissionTypes: Set<string> }) {
  const visibleRelics = filterVaultedRelics(data.unownedRelics, hideOwnedRelics)
  const visibleRelicCopies = visibleRelics.reduce((sum, relic) => sum + relic.owned, 0)
  const neededRelicNames = new Set(visibleRelics.map((relic) => relic.name))
  const visibleRoutes = data.routeGroups.map((route) => getRecommendedRoute(route, neededRelicNames)).filter((route) => selectedMissionTypes.has(route.gameMode) && route.relicNames.length > 0).sort((a, b) => b.averageChance - a.averageChance)
  const visibleMissingParts = useMemo(() => getVisibleMissingParts(data, hideOwnedRelics), [data, hideOwnedRelics])
  return <><div className="page-heading"><h1>{t.nav.Overview}</h1></div><div className="status-strip"><div className="status-summary"><div className="check-icon"><Icon name="check" size={23} /></div><div><strong>{data.imported ? t.syncedLocally : t.demoLoaded}</strong><span>{data.imported ? `${t.localFile} · ${t.justNow}` : `${t.demoData} · ${t.replaceWithImport}`}</span></div></div><div className="metric"><span>{t.missingParts}</span><strong>{visibleMissingParts.length}</strong></div><div className="metric"><span>{t.relicsOwned}</span><strong>{visibleRelics.length}</strong><small>{t.relicInventory} {visibleRelicCopies}</small></div><div className="metric warning"><span>{t.dataAge}</span><strong>{data.imported ? t.justNow : t.demo}</strong><small>{data.imported ? t.localFile : t.notSynced}</small></div></div><div className="work-grid"><section className="panel"><div className="panel-heading"><h2>{t.missingParts} <em>{visibleMissingParts.length}</em></h2><button className="text-link" onClick={() => onNavigate('Missing parts')}>{t.viewMissing} <span>›</span></button></div><div className="table-head parts-grid"><span>{t.item}</span><span>{t.part}</span><span>{t.rarity}</span><span>{t.bestRelic}</span></div><div className="table-body">{visibleMissingParts.slice(0, 8).map((part) => <div className="table-row parts-grid" key={part.id}><ItemThumb part={part} t={t} language={language} /><span>{localizePart(part.part, language, t)}</span><span className={`rarity ${part.rarity.toLowerCase()}`}><span className="rarity-gem" />{localizeRarity(part.rarity, language, t)}</span><span>{localizeRelic(part.bestRelic, language, t)}</span></div>)}</div><button className="panel-footer" onClick={() => onNavigate('Missing parts')}>{t.showMissing} <span>⌄</span></button></section><section className="panel"><div className="panel-heading"><h2>{t.relicTitle} <em>{visibleRoutes.length}</em></h2><button className="text-link" onClick={() => onNavigate('Relics')}>{t.viewRoutes} <span>›</span></button></div><div className="table-head route-grid"><span>{t.routeMode}</span><span>{t.faction}</span><span>{t.rotationA}</span><span>{t.rotationB}</span><span>{t.rotationC}</span><span>{t.average}</span></div><div className="table-body">{visibleRoutes.slice(0, 8).map((route) => <div className="table-row route-grid route-row" key={route.id} title={`${t.matchedStages}:\n${route.missions.join('\n')}`}><span className="route-mode"><strong>{localizeMissionType(route.gameMode, language, t)}</strong><small>{route.missions.length} {t.matchedStages}</small><span className="route-mission-list">{route.missions.join(' · ')}</span></span><span>{route.faction}</span><RouteChance value={route.rotations.A.chance} entries={routeDropEntries(route.rotations.A, language, t)} emptyLabel={t.noNeededRelics} /><RouteChance value={route.rotations.B.chance} entries={routeDropEntries(route.rotations.B, language, t)} emptyLabel={t.noNeededRelics} /><RouteChance value={route.rotations.C.chance} entries={routeDropEntries(route.rotations.C, language, t)} emptyLabel={t.noNeededRelics} /><RouteChance value={route.averageChance} entries={routeAverageEntries(route, language, t)} emptyLabel={t.noNeededRelics} average /></div>)}</div><button className="panel-footer" onClick={() => onNavigate('Relics')}>{t.showRoutes} <span>⌄</span></button></section></div><div className="info-strip"><Icon name="info" size={22} /><p>{t.routesLocal} {t.catalogUpdated} {formatDate(data.catalogUpdatedAt, language)}.</p></div></>
}

export default App
