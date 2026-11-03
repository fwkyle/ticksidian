#!/usr/bin/env bash
# Ticksidian 릴리즈 앱 빌드 + /Applications 설치 (2026-08-18 [kyle] 요청 — "매번 dev 실행 빡셈").
#
# 하는 일:
#   1. 프론트 빌드 + Rust 릴리즈 빌드 + macOS .app 번들 생성
#      (tauri.conf.json의 bundle.active=false는 그대로 두고, --config 인라인 오버라이드로만 켠다)
#   2. 기존 설치본이 있으면 삭제하지 않고 휴지통(~/.Trash)으로 옮긴 뒤 새 앱을 /Applications에 복사
#
# 사용: 저장소 루트에서  npm run app:install   (또는 bash scripts/install-app.sh)
# 주의: 이 스크립트는 정식 identifier(com.ticksidian.desktop)로 빌드한다.
#       dev는 npm run app:dev가 tauri.conf.dev.json 오버라이드로
#       com.ticksidian.desktop.dev 식별자를 쓴다(TICK-BUILD-001).
#       식별자가 분리돼도 같은 볼트 폴더를 두 빌드가 동시에 여는 것은 피한다.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_SRC="$ROOT/src-tauri/target/release/bundle/macos/ticksidian-desktop.app"
APP_DST="/Applications/ticksidian-desktop.app"

echo "[1/3] 릴리즈 빌드 (프론트 + Rust + .app 번들)"
cd "$ROOT/src-tauri"
cargo tauri build --config '{"bundle":{"active":true,"targets":["app"]}}'

if [ ! -d "$APP_SRC" ]; then
  echo "빌드 산출물이 없습니다: $APP_SRC" >&2
  exit 1
fi

if [ -d "$APP_DST" ]; then
  BACKUP="$HOME/.Trash/ticksidian-desktop-$(date +%Y%m%d-%H%M%S).app"
  echo "[2/3] 기존 설치본을 휴지통으로 이동: $BACKUP"
  mv "$APP_DST" "$BACKUP"
else
  echo "[2/3] 기존 설치본 없음 — 새로 설치"
fi

echo "[3/3] /Applications 에 복사"
ditto "$APP_SRC" "$APP_DST"

echo "완료 — Spotlight/런치패드에서 'ticksidian'으로 실행할 수 있습니다."
echo "앱 위치: $APP_DST"
