# Paula - Conversor 3D para IFC (App Desktop Electron)

## Visão Geral
App desktop Electron + React + TypeScript que converte arquivos 3D (FBX, OBJ, DAE, glTF/GLB) para formato IFC (Industry Foundation Classes). Focado em uso BIM, permitindo importar modelos exportados do Navisworks e converter para IFC.

## Stack Tecnológica
- **Runtime**: Electron (desktop)
- **Frontend**: React + TypeScript
- **Bundler**: Vite (via electron-vite ou similar)
- **Styling**: Tailwind CSS
- **Leitura 3D**: three.js (FBXLoader, OBJLoader, GLTFLoader, ColladaLoader)
- **Escrita IFC**: web-ifc (npm, WebAssembly)
- **3D Preview**: three.js (visualização do modelo antes/depois)

## Arquitetura

```
Paula/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main/                    # Electron main process
│   │   ├── index.ts             # Main entry, janela, IPC handlers
│   │   └── converter.ts         # Lógica de conversão (three.js → web-ifc)
│   ├── preload/
│   │   └── index.ts             # Preload script (bridge IPC)
│   └── renderer/                # React app
│       ├── index.html
│       ├── main.tsx             # React entry
│       ├── App.tsx              # App principal
│       ├── components/
│       │   ├── DropZone.tsx     # Área de drag & drop para arquivos
│       │   ├── FileInfo.tsx     # Info do arquivo carregado
│       │   ├── Viewer3D.tsx     # Preview 3D do modelo (three.js)
│       │   ├── ConvertButton.tsx # Botão de conversão com progresso
│       │   ├── Settings.tsx     # Configurações de exportação IFC
│       │   └── Header.tsx       # Barra superior
│       ├── hooks/
│       │   └── useConverter.ts  # Hook para gerenciar conversão
│       ├── styles/
│       │   └── globals.css      # Tailwind imports + custom styles
│       └── lib/
│           └── ipc.ts           # Tipagem IPC
└── resources/
    └── icon.png
```

## Fluxo de Conversão

1. **Drag & Drop** → Usuário arrasta arquivo (FBX/OBJ/DAE/glTF/GLB)
2. **Parse** → three.js carrega e parseia a geometria no main process
3. **Preview** → Modelo 3D renderizado no viewer (renderer process)
4. **Configurar** → Usuário escolhe opções IFC (schema, nome projeto, etc.)
5. **Converter** → Geometria extraída (vértices/faces) → web-ifc cria arquivo IFC
6. **Salvar** → Dialog nativo para salvar o .ifc

## Formatos Suportados (Input)
- **FBX** (.fbx) - principal export do Navisworks
- **OBJ** (.obj + .mtl)
- **glTF/GLB** (.gltf, .glb)
- **DAE/Collada** (.dae)

## Output
- **IFC4** (.ifc) usando web-ifc
- Geometria como IfcTriangulatedFaceSet ou IfcFacetedBrep
- Elementos como IfcBuildingElementProxy (genérico)
- Materiais/cores preservados quando possível

## UI/UX
- Design limpo e moderno, tema escuro
- Drag & drop central como interação principal
- Preview 3D interativo (orbit, zoom, pan)
- Barra de progresso durante conversão
- Notificações de sucesso/erro

## Etapas de Implementação

### 1. Setup do Projeto
- Inicializar com electron-vite (React + TS template)
- Configurar Tailwind CSS
- Instalar dependências (three, web-ifc, etc.)

### 2. UI Base
- Layout principal com Header, DropZone, Viewer3D
- Tema escuro com Tailwind
- Drag & drop funcional

### 3. Leitura de Arquivos 3D
- Implementar loaders (FBX, OBJ, glTF, DAE) via three.js
- Extrair meshes, geometrias, materiais
- Preview 3D com three.js

### 4. Conversão para IFC
- Inicializar web-ifc no main process
- Mapear geometria three.js → entidades IFC
- Criar estrutura IFC (Project → Site → Building → Storey → Elements)
- Preservar materiais/cores

### 5. Export e Polish
- Dialog de salvar arquivo
- Barra de progresso
- Tratamento de erros
- Ícone do app
