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

export interface ConvertOptions {
  projectName: string
  siteName: string
  buildingName: string
  storeyName: string
}

export interface ConvertResult {
  success: boolean
  data?: Uint8Array
  error?: string
}

export interface FileSelection {
  path: string
  name: string
  size: number
  extension: string
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
      saveDialog: () => Promise<string | undefined>
      saveFile: (filePath: string, data: Uint8Array) => Promise<boolean>
      convertToIfc: (options: ConvertOptions) => Promise<ConvertResult>
      saveState: () => Promise<{ success: boolean; path?: string; error?: string }>
      loadState: () => Promise<ParseResponse>
    }
  }
}
