import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Excalidraw 폰트를 우리 주소에서 받게 한다(CSP font-src 'self' 유지, TICK-DRAW-001).
// 값이 없으면 패키지가 CDN으로 떨어져 CSP에 막힌다.
(window as Window & { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH =
  "/excalidraw-assets/";

async function bootstrap() {
  // 브라우저 QA 모드: mockIPC + MemoryVaultAdapter 설치.
  // 프로덕션 번들에는 포함되지 않는다 (dynamic import + 조건 분기).
  if (import.meta.env.VITE_TICKSIDIAN_BROWSER_QA === '1') {
    await import('./qa/browser-qa-setup.ts');
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

bootstrap();
