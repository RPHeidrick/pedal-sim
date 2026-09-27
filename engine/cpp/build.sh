#!/bin/sh
# Build the C++ engine into engine/wasm/pedal-engine.wasm (macOS / Linux).
# Uses Emscripten (emcc) if it is on the PATH, otherwise Zig (pip install ziglang).
set -e
cd "$(dirname "$0")"
OUT=../wasm/pedal-engine.wasm
FLAGS="-O3 -std=c++17 -fno-exceptions -fno-rtti -fno-math-errno -mbulk-memory"

if command -v emcc >/dev/null 2>&1; then
  emcc $FLAGS -sSTANDALONE_WASM --no-entry -sALLOW_MEMORY_GROWTH=1 \
    -sEXPORTED_FUNCTIONS=_ps_alloc,_ps_free,_ps_create,_ps_destroy,_ps_set_control,_ps_process,_ps_failures,_ps_iterations,_ps_latency \
    src/*.cpp -o "$OUT"
else
  python3 -m ziglang c++ -target wasm32-wasi -mexec-model=reactor $FLAGS -w \
    -Wl,--no-entry -s src/*.cpp -o "$OUT"
fi
echo "Built $OUT ($(wc -c < "$OUT") bytes)"
