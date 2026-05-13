/**
 * IFC Category Scanner - fast line-by-line scan to discover element types
 *
 * Reads the IFC STEP file without parsing geometry, extracting only:
 * - Element entity types and their references
 * - IFCPRODUCTDEFINITIONSHAPE → ShapeRepresentation refs
 * - IFCSHAPEREPRESENTATION → FaceSet refs
 * - IFCTRIANGULATEDFACESET IDs
 *
 * Then resolves the chain: Element → ProdDefShape → ShapeRep → FaceSet
 * to map each face set to its parent element type (category).
 */

import fs from 'fs'
import readline from 'readline'

export interface IfcCategory {
  type: string
  label: string
  count: number
  faceSetCount: number
}

export interface ScanResult {
  categories: IfcCategory[]
  faceSetToCategory: Map<number, string>
}

// PT-BR labels for common IFC element types
const IFC_TYPE_LABELS: Record<string, string> = {
  'IFCMECHANICALFASTENER': 'Parafusos/Porcas',
  'IFCFASTENER': 'Fixadores',
  'IFCWALL': 'Paredes',
  'IFCWALLSTANDARDCASE': 'Paredes',
  'IFCSLAB': 'Lajes',
  'IFCBEAM': 'Vigas',
  'IFCCOLUMN': 'Colunas',
  'IFCPLATE': 'Chapas',
  'IFCMEMBER': 'Elementos Estruturais',
  'IFCBUILDINGELEMENTPROXY': 'Elementos Genericos',
  'IFCDOOR': 'Portas',
  'IFCWINDOW': 'Janelas',
  'IFCROOF': 'Telhados',
  'IFCSTAIR': 'Escadas',
  'IFCSTAIRFLIGHT': 'Lances de Escada',
  'IFCRAILING': 'Guarda-corpos',
  'IFCFURNISHINGELEMENT': 'Mobiliario',
  'IFCFOOTING': 'Fundacoes',
  'IFCCOVERING': 'Revestimentos',
  'IFCOPENINGELEMENT': 'Aberturas',
  'IFCFLOWSEGMENT': 'Tubulacoes',
  'IFCFLOWTERMINAL': 'Terminais',
  'IFCFLOWFITTING': 'Conexoes',
  'IFCPROXY': 'Proxy',
  'IFCPILE': 'Estacas',
  'IFCREINFORCINGBAR': 'Armaduras',
  'IFCTENDON': 'Cabos de Protensao',
  'IFCCURTAINWALL': 'Pele de Vidro',
  'IFCBUILDINGENTITYPART': 'Partes de Elementos',
  'IFCDUCT': 'Dutos',
  'IFCPIPE': 'Tubos',
  'IFCCABLECARRIERSEGMENT': 'Eletrocalhas',
  'IFCDISTRIBUTIONFLOWELEMENT': 'Elementos de Distribuicao',
}

// IFC entity types that represent elements with geometry (IfcProduct subtypes)
const IFC_ELEMENT_TYPES = new Set([
  'IFCWALL', 'IFCWALLSTANDARDCASE', 'IFCSLAB', 'IFCBEAM', 'IFCCOLUMN',
  'IFCDOOR', 'IFCWINDOW', 'IFCROOF', 'IFCSTAIR', 'IFCSTAIRFLIGHT',
  'IFCRAILING', 'IFCPLATE', 'IFCMEMBER', 'IFCMECHANICALFASTENER',
  'IFCFASTENER', 'IFCBUILDINGELEMENTPROXY', 'IFCFURNISHINGELEMENT',
  'IFCFLOWSEGMENT', 'IFCFLOWTERMINAL', 'IFCFLOWFITTING', 'IFCCOVERING',
  'IFCOPENINGELEMENT', 'IFCFOOTING', 'IFCPILE', 'IFCREINFORCINGBAR',
  'IFCTENDON', 'IFCPROXY', 'IFCCURTAINWALL', 'IFCBUILDINGENTITYPART',
  'IFCDUCT', 'IFCPIPE', 'IFCCABLECARRIERSEGMENT',
  'IFCDISTRIBUTIONFLOWELEMENT', 'IFCSITE', 'IFCBUILDING',
  'IFCBUILDINGSTOREY', 'IFCSPACE', 'IFCTRANSPORTELEMENT',
  'IFCVIRTUALELEMENT', 'IFCANNOTATION',
  'IFCDISTRIBUTIONCHAMBERELEMENT', 'IFCENERGYCONVERSIONDEVICE',
  'IFCFLOWCONTROLLER', 'IFCFLOWMOVINGDEVICE', 'IFCFLOWSTORAGEDEVICE',
  'IFCFLOWTREATMENTDEVICE',
])

// Parse entity line quickly: extract id, type, and all #refs
function parseEntityQuick(line: string): { id: number; type: string; refs: number[] } | null {
  const eqIdx = line.indexOf('=')
  if (eqIdx === -1) return null

  const id = parseInt(line.slice(1, eqIdx).trim())
  if (isNaN(id)) return null

  const parenOpen = line.indexOf('(', eqIdx)
  if (parenOpen === -1) return null

  const type = line.slice(eqIdx + 1, parenOpen).trim()

  // Extract all #refs from params
  const refs: number[] = []
  const params = line.slice(parenOpen)
  for (let i = 0; i < params.length; i++) {
    if (params.charCodeAt(i) === 35) { // '#'
      let j = i + 1
      while (j < params.length && params.charCodeAt(j) >= 48 && params.charCodeAt(j) <= 57) j++
      if (j > i + 1) refs.push(parseInt(params.slice(i + 1, j)))
      i = j - 1
    }
  }

  return { id, type, refs }
}

function getLabelForType(type: string): string {
  const label = IFC_TYPE_LABELS[type]
  if (label) return label
  // Strip IFC prefix and format nicely
  const raw = type.startsWith('IFC') ? type.slice(3) : type
  return raw.charAt(0) + raw.slice(1).toLowerCase()
}

export async function scanIfcCategories(
  filePath: string,
  onProgress?: (message: string, percent: number) => void
): Promise<ScanResult> {
  const stats = fs.statSync(filePath)
  const fileSize = stats.size

  onProgress?.('Analisando categorias...', 2)

  // Storage for entities of interest (only IDs and refs, not geometry)
  const elements = new Map<number, { type: string; refs: number[] }>()
  const prodDefShapes = new Map<number, number[]>()   // id → refs
  const shapeReps = new Map<number, number[]>()       // id → refs
  const faceSetIds = new Set<number>()

  // Stream read the file
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf-8' })
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity })

  let bytesRead = 0
  let lastProgressPercent = 0

  for await (const line of rl) {
    bytesRead += Buffer.byteLength(line, 'utf-8') + 2

    // Progress
    const percent = 2 + Math.round((bytesRead / fileSize) * 70)
    if (percent > lastProgressPercent + 2) {
      lastProgressPercent = percent
      onProgress?.(
        `Analisando: ${Math.round(bytesRead / 1048576)} MB / ${Math.round(fileSize / 1048576)} MB`,
        Math.min(percent, 75)
      )
    }

    // Skip non-entity lines
    if (line.charCodeAt(0) !== 35) continue // '#'

    const entity = parseEntityQuick(line)
    if (!entity) continue

    if (entity.type === 'IFCTRIANGULATEDFACESET') {
      faceSetIds.add(entity.id)
    } else if (entity.type === 'IFCSHAPEREPRESENTATION') {
      shapeReps.set(entity.id, entity.refs)
    } else if (entity.type === 'IFCPRODUCTDEFINITIONSHAPE') {
      prodDefShapes.set(entity.id, entity.refs)
    } else if (IFC_ELEMENT_TYPES.has(entity.type)) {
      elements.set(entity.id, { type: entity.type, refs: entity.refs })
    }
  }

  onProgress?.('Resolvendo categorias...', 78)

  // Build reverse chain: faceSet → shapeRep → prodDefShape → element type

  // Step 1: shapeRepId → faceSetIds (filter refs to only known face sets)
  const shapeRepToFaceSets = new Map<number, number[]>()
  for (const [srId, refs] of shapeReps) {
    const faceRefs = refs.filter(r => faceSetIds.has(r))
    if (faceRefs.length > 0) {
      shapeRepToFaceSets.set(srId, faceRefs)
    }
  }

  // Step 2: prodDefShapeId → shapeRepIds (filter refs to only known shape reps)
  const prodDefToShapeReps = new Map<number, number[]>()
  for (const [pdsId, refs] of prodDefShapes) {
    const srRefs = refs.filter(r => shapeRepToFaceSets.has(r))
    if (srRefs.length > 0) {
      prodDefToShapeReps.set(pdsId, srRefs)
    }
  }

  // Step 3: element → prodDefShape (find which ref points to a known prodDefShape)
  // Then chain all the way to face sets
  const faceSetToCategory = new Map<number, string>()
  const categoryCount = new Map<string, number>()
  const categoryFaceSetCount = new Map<string, number>()

  for (const [, elem] of elements) {
    // Find the ref that points to a prodDefShape
    for (const ref of elem.refs) {
      const srRefs = prodDefToShapeReps.get(ref)
      if (!srRefs) continue

      // Found the prodDefShape → follow to face sets
      categoryCount.set(elem.type, (categoryCount.get(elem.type) || 0) + 1)

      for (const srId of srRefs) {
        const fsIds = shapeRepToFaceSets.get(srId)
        if (!fsIds) continue
        for (const fsId of fsIds) {
          faceSetToCategory.set(fsId, elem.type)
          categoryFaceSetCount.set(elem.type, (categoryFaceSetCount.get(elem.type) || 0) + 1)
        }
      }
      break // Found the prodDefShape ref, no need to check other refs
    }
  }

  // Also count face sets without a known category
  let uncategorizedFaceSets = 0
  for (const fsId of faceSetIds) {
    if (!faceSetToCategory.has(fsId)) {
      uncategorizedFaceSets++
    }
  }

  // Build sorted category list
  const categories: IfcCategory[] = []
  for (const [type, count] of categoryCount) {
    categories.push({
      type,
      label: getLabelForType(type),
      count,
      faceSetCount: categoryFaceSetCount.get(type) || 0
    })
  }

  // Add uncategorized if any
  if (uncategorizedFaceSets > 0) {
    categories.push({
      type: '__UNCATEGORIZED__',
      label: 'Sem categoria',
      count: uncategorizedFaceSets,
      faceSetCount: uncategorizedFaceSets
    })
  }

  // Sort by count descending
  categories.sort((a, b) => b.count - a.count)

  onProgress?.(
    `${categories.length} categorias encontradas, ${faceSetIds.size} face sets`,
    98
  )

  return { categories, faceSetToCategory }
}

/**
 * Build the set of face set IDs to exclude based on excluded category types.
 * Requires the faceSetToCategory map from a previous scan.
 */
export function buildExcludedFaceSetIds(
  faceSetToCategory: Map<number, string>,
  excludedCategories: string[]
): Set<number> {
  const excludedSet = new Set(excludedCategories)
  const excludedFaceSetIds = new Set<number>()

  for (const [fsId, category] of faceSetToCategory) {
    if (excludedSet.has(category)) {
      excludedFaceSetIds.add(fsId)
    }
  }

  return excludedFaceSetIds
}
