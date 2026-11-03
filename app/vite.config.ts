import { cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const here = dirname(fileURLToPath(import.meta.url))

/**
 * Excalidraw 폰트를 자체 origin에서 서빙한다 (2026-08-23 TICK-DRAW-001).
 *
 * Why: 패키지는 `window.EXCALIDRAW_ASSET_PATH`가 없으면 폰트를 CDN(unpkg)에서 받는데,
 * 우리 CSP는 `font-src 'self' data:`라 막힌다. CSP를 푸는 것은 잠긴 계약 8 위반이므로
 * 폰트를 `public/excalidraw-assets/fonts`로 복사해 우리 주소에서 준다.
 * 폰트는 저장소에 커밋하지 않는다(.gitignore) — 빌드/개발 시작 때마다 여기서 만든다.
 */
function excalidrawAssets(): Plugin {
  return {
    name: 'ticksidian-excalidraw-assets',
    buildStart() {
      const from = resolve(here, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
      const to = resolve(here, 'public/excalidraw-assets/fonts')
      if (!existsSync(from)) return
      mkdirSync(dirname(to), { recursive: true })
      cpSync(from, to, { recursive: true })
    },
  }
}

export default defineConfig({
  // worktree의 node_modules 심볼릭 링크에서도 번들 글꼴을 읽는다. 소스/의존성만 허용.
  server: { fs: { allow: [here, realpathSync(resolve(here, 'node_modules'))] } },
  plugins: [
    react(),
    tailwindcss(),
    excalidrawAssets(),
  ],
})
