#!/bin/sh
set -eu

# CI와 미설치 환경은 원래 컴파일러를 그대로 사용한다.
if [ -z "${CI:-}" ] && command -v kache >/dev/null 2>&1; then
  exec kache "$@"
fi

exec "$@"
