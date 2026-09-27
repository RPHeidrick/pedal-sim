# Build the C++ engine into engine/wasm/pedal-engine.wasm (Windows, PowerShell).
#
# One-time setup (see engine/cpp/README.md):
#   git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
#   cd C:\emsdk; .\emsdk install latest; .\emsdk activate latest
# Each new terminal:
#   C:\emsdk\emsdk_env.ps1
# Then from the pedal-sim folder:
#   .\engine\cpp\build.ps1

$ErrorActionPreference = "Stop"
$engine = Split-Path -Parent $PSScriptRoot   # the engine folder
$src = Join-Path $PSScriptRoot "src"
$out = Join-Path $engine "wasm\pedal-engine.wasm"

$exports = "_ps_alloc,_ps_free,_ps_create,_ps_destroy,_ps_set_control,_ps_process,_ps_failures,_ps_iterations,_ps_latency"

emcc -O3 -std=c++17 -fno-exceptions -fno-rtti -fno-math-errno -mbulk-memory `
  -sSTANDALONE_WASM --no-entry -sALLOW_MEMORY_GROWTH=1 `
  "-sEXPORTED_FUNCTIONS=$exports" `
  (Get-ChildItem "$src\*.cpp").FullName `
  -o $out

if ($LASTEXITCODE -ne 0) { throw "emcc failed" }
Write-Host "Built $out ($((Get-Item $out).Length) bytes)"
