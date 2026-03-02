import fs from 'fs'
import { MeshStoreReader } from './mesh-store'

interface ConvertOptions {
  tempFile: string
  meshCount: number
  outputPath: string
  projectName: string
  siteName: string
  buildingName: string
  storeyName: string
  onProgress?: (message: string, percent: number) => void
}

// IFC STEP helpers
const str = (s: string) => "'" + s.replace(/\\/g, '\\\\').replace(/'/g, "''") + "'"
const real = (v: number): string => {
  if (!Number.isFinite(v)) return '0.'
  // 6 decimal places max - massively reduces file size vs full precision
  const s = v.toFixed(6)
  // Remove trailing zeros but keep the decimal point (STEP requires it)
  return s.replace(/(\.\d*?)0+$/, '$1')
}
const ref = (id: number) => '#' + id

// Quantize color to key for deduplication (2 decimal places)
const colorKey = (r: number, g: number, b: number) =>
  `${r.toFixed(2)},${g.toFixed(2)},${b.toFixed(2)}`

function generateGuid(): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'
  let guid = ''
  for (let i = 0; i < 22; i++) {
    guid += chars[Math.floor(Math.random() * 64)]
  }
  return guid
}

export async function convertToIfc(options: ConvertOptions): Promise<void> {
  const stream = fs.createWriteStream(options.outputPath)
  const w = (line: string) => { stream.write(line + '\n') }

  let nextId = 1
  const id = () => nextId++

  const mkPlacement = (relTo: number | null): number => {
    const axId = id()
    w(`#${axId}=IFCAXIS2PLACEMENT3D(#${originId},#${dirZId},#${dirXId});`)
    const lpId = id()
    w(`#${lpId}=IFCLOCALPLACEMENT(${relTo ? '#' + relTo : '$'},#${axId});`)
    return lpId
  }

  // ---- HEADER ----
  w('ISO-10303-21;')
  w('HEADER;')
  w("FILE_DESCRIPTION(('ViewDefinition [CoordinationView]'),'2;1');")
  w(`FILE_NAME('model.ifc','${new Date().toISOString().slice(0, 19)}',($),($),'Paula','Paula',$);`)
  w("FILE_SCHEMA(('IFC4'));")
  w('ENDSEC;')
  w('DATA;')

  // ---- STRUCTURAL ENTITIES ----

  const personId = id()
  w(`#${personId}=IFCPERSON('Paula','Converter','Paula',$,$,$,$,$);`)

  const orgId = id()
  w(`#${orgId}=IFCORGANIZATION('Paula','Paula Converter',$,$,$);`)

  const poId = id()
  w(`#${poId}=IFCPERSONANDORGANIZATION(#${personId},#${orgId},$);`)

  const appId = id()
  w(`#${appId}=IFCAPPLICATION(#${orgId},'1.0.0','Paula - 3D to IFC Converter','Paula');`)

  const ohId = id()
  const ts = Math.floor(Date.now() / 1000)
  w(`#${ohId}=IFCOWNERHISTORY(#${poId},#${appId},$,.ADDED.,$,$,$,${ts});`)

  // Units
  const luId = id()
  w(`#${luId}=IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.);`)
  const auId = id()
  w(`#${auId}=IFCSIUNIT(*,.AREAUNIT.,$,.SQUARE_METRE.);`)
  const vuId = id()
  w(`#${vuId}=IFCSIUNIT(*,.VOLUMEUNIT.,$,.CUBIC_METRE.);`)
  const anId = id()
  w(`#${anId}=IFCSIUNIT(*,.PLANEANGLEUNIT.,$,.RADIAN.);`)
  const uaId = id()
  w(`#${uaId}=IFCUNITASSIGNMENT((#${luId},#${auId},#${vuId},#${anId}));`)

  // Geometric context
  const originId = id()
  w(`#${originId}=IFCCARTESIANPOINT((0.,0.,0.));`)
  const dirZId = id()
  w(`#${dirZId}=IFCDIRECTION((0.,0.,1.));`)
  const dirXId = id()
  w(`#${dirXId}=IFCDIRECTION((1.,0.,0.));`)

  const ax2Id = id()
  w(`#${ax2Id}=IFCAXIS2PLACEMENT3D(#${originId},#${dirZId},#${dirXId});`)

  const ctxId = id()
  w(`#${ctxId}=IFCGEOMETRICREPRESENTATIONCONTEXT($,'Model',3,1E-05,#${ax2Id},$);`)

  const subCtxId = id()
  w(`#${subCtxId}=IFCGEOMETRICREPRESENTATIONSUBCONTEXT('Body','Model',*,*,*,*,#${ctxId},$,.MODEL_VIEW.,$);`)

  // Project
  const projId = id()
  w(`#${projId}=IFCPROJECT(${str(generateGuid())},#${ohId},${str(options.projectName || 'Projeto Convertido')},${str('Convertido por Paula')},$,$,$,(#${ctxId}),#${uaId});`)

  // Site
  const spId = mkPlacement(null)
  const siteId = id()
  w(`#${siteId}=IFCSITE(${str(generateGuid())},#${ohId},${str(options.siteName || 'Site')},$,$,#${spId},$,$,.ELEMENT.,$,$,$,$,$);`)

  // Building
  const bpId = mkPlacement(spId)
  const bldgId = id()
  w(`#${bldgId}=IFCBUILDING(${str(generateGuid())},#${ohId},${str(options.buildingName || 'Edificio')},$,$,#${bpId},$,$,.ELEMENT.,$,$,$);`)

  // Storey
  const stpId = mkPlacement(bpId)
  const storeyId = id()
  w(`#${storeyId}=IFCBUILDINGSTOREY(${str(generateGuid())},#${ohId},${str(options.storeyName || 'Pavimento')},$,$,#${stpId},$,$,.ELEMENT.,0.);`)

  // RelAggregates
  const ag1 = id()
  w(`#${ag1}=IFCRELAGGREGATES(${str(generateGuid())},#${ohId},$,$,#${projId},(#${siteId}));`)
  const ag2 = id()
  w(`#${ag2}=IFCRELAGGREGATES(${str(generateGuid())},#${ohId},$,$,#${siteId},(#${bldgId}));`)
  const ag3 = id()
  w(`#${ag3}=IFCRELAGGREGATES(${str(generateGuid())},#${ohId},$,$,#${bldgId},(#${storeyId}));`)

  // ---- Shared placement for all elements (all at origin relative to storey) ----
  const sharedPlacementId = mkPlacement(stpId)

  // ---- Style cache: deduplicate by color ----
  const styleCache = new Map<string, number>() // colorKey -> IFCSURFACESTYLE id

  const getOrCreateStyle = (r: number, g: number, b: number): number => {
    const key = colorKey(r, g, b)
    const cached = styleCache.get(key)
    if (cached !== undefined) return cached

    const cId = id()
    w(`#${cId}=IFCCOLOURRGB($,${real(r)},${real(g)},${real(b)});`)
    const ssrId = id()
    w(`#${ssrId}=IFCSURFACESTYLERENDERING(#${cId},0.,$,$,$,$,$,$,.NOTDEFINED.);`)
    const ssId = id()
    w(`#${ssId}=IFCSURFACESTYLE($,.BOTH.,(#${ssrId}));`)
    styleCache.set(key, ssId)
    return ssId
  }

  // ---- STREAM MESHES ----
  const reader = new MeshStoreReader(options.tempFile)
  const elementIds: number[] = []
  let processed = 0

  for (let i = 0; i < reader.meshCount; i++) {
    const mesh = reader.readNext()
    if (!mesh) break

    if (mesh.vertices.length === 0 || mesh.indices.length === 0) continue

    // CartesianPointList3D - write incrementally to avoid huge strings
    const clId = id()
    stream.write(`#${clId}=IFCCARTESIANPOINTLIST3D((`)
    for (let j = 0; j < mesh.vertices.length; j += 3) {
      if (j > 0) stream.write(',')
      stream.write(`(${real(mesh.vertices[j])},${real(mesh.vertices[j + 1])},${real(mesh.vertices[j + 2])})`)
    }
    stream.write('),$);\n')

    // TriangulatedFaceSet - write incrementally
    const fsId = id()
    stream.write(`#${fsId}=IFCTRIANGULATEDFACESET(#${clId},$,$,(`)
    for (let j = 0; j < mesh.indices.length; j += 3) {
      if (j > 0) stream.write(',')
      stream.write(`(${mesh.indices[j] + 1},${mesh.indices[j + 1] + 1},${mesh.indices[j + 2] + 1})`)
    }
    stream.write('),$);\n')

    // Style (shared by color)
    const ssId = getOrCreateStyle(mesh.color.r, mesh.color.g, mesh.color.b)
    const siId = id()
    w(`#${siId}=IFCSTYLEDITEM(#${fsId},(#${ssId}),$);`)

    // Shape representation
    const srId = id()
    w(`#${srId}=IFCSHAPEREPRESENTATION(#${subCtxId},'Body','Tessellation',(#${fsId}));`)
    const pdsId = id()
    w(`#${pdsId}=IFCPRODUCTDEFINITIONSHAPE($,$,(#${srId}));`)

    // Element (shared placement)
    const elId = id()
    w(`#${elId}=IFCBUILDINGELEMENTPROXY(${str(generateGuid())},#${ohId},${str(mesh.name || 'Elemento')},$,$,#${sharedPlacementId},#${pdsId},$,.NOTDEFINED.);`)

    elementIds.push(elId)
    processed++

    // Handle backpressure every 500 meshes
    if (processed % 500 === 0) {
      const pct = Math.round((i / reader.meshCount) * 95)
      options.onProgress?.(`Convertendo: ${processed}/${reader.meshCount} elementos`, pct)

      // Wait for stream to drain if buffer is full
      if (!stream.write('')) {
        await new Promise<void>(resolve => stream.once('drain', resolve))
      }
    }
  }
  reader.close()

  // RelContainedInSpatialStructure - split into batches of 1000 to avoid mega-lines
  const BATCH_SIZE = 1000
  for (let start = 0; start < elementIds.length; start += BATCH_SIZE) {
    const end = Math.min(start + BATCH_SIZE, elementIds.length)
    const rcId = id()
    stream.write(`#${rcId}=IFCRELCONTAINEDINSPATIALSTRUCTURE(${str(generateGuid())},#${ohId},$,$,(`)
    for (let i = start; i < end; i++) {
      if (i > start) stream.write(',')
      stream.write(ref(elementIds[i]))
    }
    stream.write(`),#${storeyId});\n`)
  }

  w('ENDSEC;')
  w('END-ISO-10303-21;')

  // Wait for stream to finish writing
  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve())
    stream.on('error', reject)
  })

  options.onProgress?.('Concluido!', 100)
}
