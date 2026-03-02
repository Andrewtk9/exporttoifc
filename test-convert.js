const path = require('path')
const fs = require('fs')
const WebIFC = require('web-ifc')

// IFC4 typed value helpers
const R = (v) => new WebIFC.IFC4.IfcReal(v)                    // REAL values (directions, precision)
const L = (v) => new WebIFC.IFC4.IfcLengthMeasure(v)           // Length values (coordinates, elevation)
const NR = (v) => new WebIFC.IFC4.IfcNormalisedRatioMeasure(v) // 0-1 range (colors, transparency)
const INT = (v) => new WebIFC.IFC4.IfcInteger(v)               // Integer values

class MeshStoreReader {
  constructor(fp) {
    this.fd = fs.openSync(fp, 'r')
    const h = Buffer.alloc(12); fs.readSync(this.fd, h, 0, 12, 0)
    if (h.slice(0,4).toString() !== 'MESH') throw new Error('Invalid')
    this.meshCount = h.readUInt32LE(8); this.pos = 12
  }
  rb(n) { const b = Buffer.alloc(n); fs.readSync(this.fd, b, 0, n, this.pos); this.pos += n; return b }
  readNext() {
    try {
      const nl = this.rb(4).readUInt32LE(0); const name = nl > 0 ? this.rb(nl).toString('utf-8') : ''
      const vc = this.rb(4).readUInt32LE(0); const v = new Array(vc)
      if (vc > 0) { const vb = this.rb(vc*8); for (let i=0;i<vc;i++) v[i]=vb.readDoubleLE(i*8) }
      const ic = this.rb(4).readUInt32LE(0); const idx = new Array(ic)
      if (ic > 0) { const ib = this.rb(ic*4); for (let i=0;i<ic;i++) idx[i]=ib.readInt32LE(i*4) }
      const nc = this.rb(4).readUInt32LE(0); const n = new Array(nc)
      if (nc > 0) { const nb = this.rb(nc*8); for (let i=0;i<nc;i++) n[i]=nb.readDoubleLE(i*8) }
      const cb = this.rb(12)
      return { name, vertices: v, indices: idx, normals: n, color: { r: cb.readFloatLE(0), g: cb.readFloatLE(4), b: cb.readFloatLE(8) } }
    } catch { return null }
  }
  close() { fs.closeSync(this.fd) }
}

function gg() {
  const c='0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_-'
  let g=''; for(let i=0;i<22;i++) g+=c[Math.floor(Math.random()*64)]; return g
}

async function test() {
  const reader = new MeshStoreReader(path.join(__dirname, 'teste', 'paula-state.bin'))
  const mesh = reader.readNext(); reader.close()
  if (!mesh) { console.log('No mesh'); return }
  console.log('Mesh:', mesh.name, mesh.vertices.length/3, 'pts', mesh.indices.length/3, 'tris')

  const ifcApi = new WebIFC.IfcAPI()
  ifcApi.SetWasmPath(path.dirname(require.resolve('web-ifc/web-ifc-node.wasm')) + '/', true)
  await ifcApi.Init()
  const m = ifcApi.CreateModel({ schema: WebIFC.Schemas.IFC4 })
  const H = (v) => new WebIFC.Handle(v)
  let nid = 1; const id = () => nid++

  function w(label, obj) {
    try { ifcApi.WriteLine(m, obj); console.log('OK:', label) }
    catch(e) { console.error('FAIL:', label, '-', e.message); throw e }
  }

  // Header entities
  const p=id(); w('Person', {expressID:p, type:WebIFC.IFCPERSON, Identification:{type:1,value:'P'}, FamilyName:{type:1,value:'C'}, GivenName:{type:1,value:'P'}, MiddleNames:null, PrefixTitles:null, SuffixTitles:null, Roles:null, Addresses:null})
  const o=id(); w('Org', {expressID:o, type:WebIFC.IFCORGANIZATION, Identification:{type:1,value:'P'}, Name:{type:1,value:'P'}, Description:null, Roles:null, Addresses:null})
  const po=id(); w('PersOrg', {expressID:po, type:WebIFC.IFCPERSONANDORGANIZATION, ThePerson:H(p), TheOrganization:H(o), Roles:null})
  const ap=id(); w('App', {expressID:ap, type:WebIFC.IFCAPPLICATION, ApplicationDeveloper:H(o), Version:{type:1,value:'1'}, ApplicationFullName:{type:1,value:'P'}, ApplicationIdentifier:{type:1,value:'P'}})
  const oh=id(); w('OwnerHistory', {expressID:oh, type:WebIFC.IFCOWNERHISTORY, OwningUser:H(po), OwningApplication:H(ap), State:null, ChangeAction:{type:3,value:'ADDED'}, LastModifiedDate:null, LastModifyingUser:null, LastModifyingApplication:null, CreationDate:INT(1000000)})
  const lu=id(); w('SIUnit', {expressID:lu, type:WebIFC.IFCSIUNIT, UnitType:{type:3,value:'LENGTHUNIT'}, Prefix:null, Name:{type:3,value:'METRE'}, Dimensions:null})
  const ua=id(); w('UnitAssign', {expressID:ua, type:WebIFC.IFCUNITASSIGNMENT, Units:[H(lu)]})

  // Geometry context - using L() for coordinates, R() for reals
  const og=id(); w('CartPoint', {expressID:og, type:WebIFC.IFCCARTESIANPOINT, Coordinates:[L(0),L(0),L(0)]})
  const dz=id(); w('DirZ', {expressID:dz, type:WebIFC.IFCDIRECTION, DirectionRatios:[R(0),R(0),R(1)]})
  const dx=id(); w('DirX', {expressID:dx, type:WebIFC.IFCDIRECTION, DirectionRatios:[R(1),R(0),R(0)]})
  const ax=id(); w('Axis2Plac', {expressID:ax, type:WebIFC.IFCAXIS2PLACEMENT3D, Location:H(og), Axis:H(dz), RefDirection:H(dx)})
  const cx=id(); w('GeoCtx', {expressID:cx, type:WebIFC.IFCGEOMETRICREPRESENTATIONCONTEXT, ContextIdentifier:null, ContextType:{type:1,value:'Model'}, CoordinateSpaceDimension:INT(3), Precision:R(1e-5), WorldCoordinateSystem:H(ax), TrueNorth:null})
  const sx=id(); w('SubCtx', {expressID:sx, type:WebIFC.IFCGEOMETRICREPRESENTATIONSUBCONTEXT, ContextIdentifier:{type:1,value:'Body'}, ContextType:{type:1,value:'Model'}, CoordinateSpaceDimension:null, Precision:null, WorldCoordinateSystem:null, TrueNorth:null, ParentContext:H(cx), TargetScale:null, TargetView:{type:3,value:'MODEL_VIEW'}, UserDefinedTargetView:null})
  const pj=id(); w('Project', {expressID:pj, type:WebIFC.IFCPROJECT, GlobalId:{type:1,value:gg()}, OwnerHistory:H(oh), Name:{type:1,value:'T'}, Description:{type:1,value:'T'}, ObjectType:null, LongName:null, Phase:null, RepresentationContexts:[H(cx)], UnitsInContext:H(ua)})

  const mkP = (rel) => {
    const a=id(),l=id()
    w('Ax2P', {expressID:a, type:WebIFC.IFCAXIS2PLACEMENT3D, Location:H(og), Axis:H(dz), RefDirection:H(dx)})
    w('LocalP', {expressID:l, type:WebIFC.IFCLOCALPLACEMENT, PlacementRelTo:rel?H(rel):null, RelativePlacement:H(a)})
    return l
  }

  const sp=mkP(null)
  const si=id(); w('Site', {expressID:si, type:WebIFC.IFCSITE, GlobalId:{type:1,value:gg()}, OwnerHistory:H(oh), Name:{type:1,value:'S'}, Description:null, ObjectType:null, ObjectPlacement:H(sp), Representation:null, LongName:null, CompositionType:{type:3,value:'ELEMENT'}, RefLatitude:null, RefLongitude:null, RefElevation:null, LandTitleNumber:null, SiteAddress:null})
  const bp=mkP(sp)
  const bl=id(); w('Building', {expressID:bl, type:WebIFC.IFCBUILDING, GlobalId:{type:1,value:gg()}, OwnerHistory:H(oh), Name:{type:1,value:'B'}, Description:null, ObjectType:null, ObjectPlacement:H(bp), Representation:null, LongName:null, CompositionType:{type:3,value:'ELEMENT'}, ElevationOfRefHeight:null, ElevationOfTerrain:null, BuildingAddress:null})
  const tp=mkP(bp)
  const st=id(); w('Storey', {expressID:st, type:WebIFC.IFCBUILDINGSTOREY, GlobalId:{type:1,value:gg()}, OwnerHistory:H(oh), Name:{type:1,value:'P'}, Description:null, ObjectType:null, ObjectPlacement:H(tp), Representation:null, LongName:null, CompositionType:{type:3,value:'ELEMENT'}, Elevation:L(0)})

  const mkA = (from,to) => { const r=id(); w('Agg', {expressID:r, type:WebIFC.IFCRELAGGREGATES, GlobalId:{type:1,value:gg()}, OwnerHistory:H(oh), Name:null, Description:null, RelatingObject:H(from), RelatedObjects:to.map(x=>H(x))}) }
  mkA(pj,[si]); mkA(si,[bl]); mkA(bl,[st])

  // Mesh geometry - using L() for coordinates, NR() for colors
  console.log('\n--- Mesh ---')
  const verts=mesh.vertices, inds=mesh.indices
  const clId=id(), cp=[]
  for(let i=0;i<verts.length;i+=3) cp.push([L(verts[i]),L(verts[i+1]),L(verts[i+2])])
  w('CartPtList3D', {expressID:clId, type:WebIFC.IFCCARTESIANPOINTLIST3D, CoordList:cp, TagList:null})

  const fi=[]
  for(let i=0;i<inds.length;i+=3) fi.push([INT(inds[i]+1),INT(inds[i+1]+1),INT(inds[i+2]+1)])
  const fsId=id(); w('TriFaceSet', {expressID:fsId, type:WebIFC.IFCTRIANGULATEDFACESET, Coordinates:H(clId), Closed:null, Normals:null, CoordIndex:fi, PnIndex:null})

  const cId=id(); w('ColourRGB', {expressID:cId, type:WebIFC.IFCCOLOURRGB, Name:null, Red:NR(mesh.color.r), Green:NR(mesh.color.g), Blue:NR(mesh.color.b)})
  const ssrId=id(); w('SurfStyleRend', {expressID:ssrId, type:WebIFC.IFCSURFACESTYLERENDERING, SurfaceColour:H(cId), Transparency:NR(0), DiffuseColour:null, TransmissionColour:null, DiffuseTransmissionColour:null, ReflectionColour:null, SpecularColour:null, SpecularHighlight:null, ReflectanceMethod:{type:3,value:'NOTDEFINED'}})
  const ssId=id(); w('SurfStyle', {expressID:ssId, type:WebIFC.IFCSURFACESTYLE, Name:{type:1,value:'s'}, Side:{type:3,value:'BOTH'}, Styles:[H(ssrId)]})
  const siId=id(); w('StyledItem', {expressID:siId, type:WebIFC.IFCSTYLEDITEM, Item:H(fsId), Styles:[H(ssId)], Name:null})
  const srId=id(); w('ShapeRep', {expressID:srId, type:WebIFC.IFCSHAPEREPRESENTATION, ContextOfItems:H(sx), RepresentationIdentifier:{type:1,value:'Body'}, RepresentationType:{type:1,value:'Tessellation'}, Items:[H(fsId)]})
  const pdsId=id(); w('ProdDefShape', {expressID:pdsId, type:WebIFC.IFCPRODUCTDEFINITIONSHAPE, Name:null, Description:null, Representations:[H(srId)]})
  const ep=mkP(tp)
  const el=id(); w('BldgElemProxy', {expressID:el, type:WebIFC.IFCBUILDINGELEMENTPROXY, GlobalId:{type:1,value:gg()}, OwnerHistory:H(oh), Name:{type:1,value:mesh.name||'E'}, Description:null, ObjectType:null, ObjectPlacement:H(ep), Representation:H(pdsId), Tag:null, PredefinedType:{type:3,value:'NOTDEFINED'}})
  const rc=id(); w('RelContained', {expressID:rc, type:WebIFC.IFCRELCONTAINEDINSPATIALSTRUCTURE, GlobalId:{type:1,value:gg()}, OwnerHistory:H(oh), Name:null, Description:null, RelatedElements:[H(el)], RelatingStructure:H(st)})

  console.log('\nSaving...')
  const data = ifcApi.SaveModel(m); ifcApi.CloseModel(m)
  const out = path.join(__dirname, 'teste', 'test-output.ifc')
  fs.writeFileSync(out, Buffer.from(data))
  console.log('SUCCESS!', data.length, 'bytes ->', out)

  // Verify no nan in output
  const content = fs.readFileSync(out, 'utf-8')
  const nanCount = (content.match(/nan/gi) || []).length
  console.log('\nnan occurrences in output:', nanCount)
  if (nanCount === 0) console.log('NO NaN values - IFC should be valid!')
  else console.log('WARNING: Still has NaN values!')

  // Show first CartesianPoint line
  const lines = content.split('\n')
  for (const line of lines) {
    if (line.includes('IFCCARTESIANPOINT')) { console.log('Sample CartesianPoint:', line.trim()); break }
  }
  for (const line of lines) {
    if (line.includes('IFCCARTESIANPOINTLIST3D')) { console.log('Sample PointList3D:', line.trim().substring(0, 200) + '...'); break }
  }
  for (const line of lines) {
    if (line.includes('IFCCOLOURRGB')) { console.log('Sample ColourRGB:', line.trim()); break }
  }
}

test().catch(e => { console.error('\nFATAL:', e.message) })
