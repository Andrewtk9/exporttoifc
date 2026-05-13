export interface MeshData {
  name: string
  vertices: number[]
  indices: number[]
  normals: number[]
  color: { r: number; g: number; b: number }
}

export interface ParseResult {
  meshes: MeshData[]       // preview sample (not all meshes)
  totalVertices: number
  totalFaces: number
  meshCount: number        // total mesh count (includes ones not in preview)
}

export interface ParseResponse {
  success: boolean
  data?: ParseResult
  error?: string
}

export type OptimizationLevel = 'none' | 'light' | 'medium' | 'aggressive'

export interface ConvertOptions {
  projectName: string
  siteName: string
  buildingName: string
  storeyName: string
  optimization: OptimizationLevel
}

export interface OptimizationStats {
  originalVertices: number
  originalFaces: number
  optimizedVertices: number
  optimizedFaces: number
  meshesBeforeOptimization: number
  meshesAfterOptimization: number
}

export interface ConvertResult {
  success: boolean
  data?: Uint8Array
  error?: string
  canceled?: boolean
  optimizationStats?: OptimizationStats
}

export interface FileSelection {
  path: string
  name: string
  size: number
  extension: string
}

export interface IfcCategory {
  type: string
  label: string
  count: number
  faceSetCount: number
}

export interface ScanCategoriesResult {
  success: boolean
  categories?: IfcCategory[]
  error?: string
}

export interface OptimizeIfcOptions {
  inputPath: string
  level: OptimizationLevel
  excludedCategories?: string[]
}

export interface OptimizeIfcResult {
  success: boolean
  error?: string
  canceled?: boolean
  stats?: OptimizationStats
}

declare global {
  interface Window {
    api: {
      minimize: () => Promise<void>
      maximize: () => Promise<void>
      close: () => Promise<void>
      openFileDialog: () => Promise<FileSelection | null>
      getFileInfo: (filePath: string) => Promise<FileSelection>
      parseFile: (filePath: string) => Promise<ParseResponse>
      onParseProgress: (callback: (msg: string) => void) => () => void
      onConvertProgress: (callback: (data: { message: string; percent: number }) => void) => () => void
      onOptimizeProgress: (callback: (data: { message: string; percent: number }) => void) => () => void
      onScanProgress: (callback: (data: { message: string; percent: number }) => void) => () => void
      saveDialog: () => Promise<string | undefined>
      saveFile: (filePath: string, data: Uint8Array) => Promise<boolean>
      convertToIfc: (options: ConvertOptions) => Promise<ConvertResult>
      openIfcDialog: () => Promise<string | null>
      scanCategories: (filePath: string) => Promise<ScanCategoriesResult>
      optimizeIfc: (options: OptimizeIfcOptions) => Promise<OptimizeIfcResult>
      saveState: () => Promise<{ success: boolean; path?: string; error?: string }>
      loadState: () => Promise<ParseResponse>
    }
  }
}
