$ErrorActionPreference = "Stop"

# Kill any leftover instances before we wipe dist/. PyInstaller --clean blows
# up with "Access is denied" if Jarvis.exe is still running (manual launch,
# Explorer thumbnail handler, antivirus scan, etc.). Same for the wizard and
# installer. -ErrorAction SilentlyContinue swallows the "no process found"
# case so the build doesn't trip on a clean machine.
foreach ($p in @("Jarvis", "JarvisSetup", "JarvisInstaller")) {
    Get-Process -Name $p -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# Assumes the venv already has the right packages installed: PyInstaller,
# torch (XPU build from https://download.pytorch.org/whl/xpu), torch-directml,
# webrtcvad-wheels, plus everything in requirements.txt. The build script no
# longer reinstalls them -- if a package is missing, PyInstaller will fail
# loudly and you can pip install it manually.
#
# Runtime device picker (voice/stt.py) tries XPU first (best perf on Intel
# iGPU/Arc), then DirectML (any DX12 GPU: AMD Radeon incl. Ryzen iGPU,
# Intel iGPU, NVIDIA), then CPU. CUDA wheels of torch must NOT be installed
# in the build venv -- they bloat the bundle by ~2.5GB and aren't used.
# Orpheus-TTS uses vLLM, which selects CUDA automatically at runtime.

# PyInstaller's stdhook for webrtcvad calls copy_metadata('webrtcvad'), but we
# installed webrtcvad-wheels (drop-in that dodges the MSVC build). The import
# name matches; the distribution name doesn't. Drop a minimal dist-info stub
# named "webrtcvad" next to the real package so the hook finds metadata and
# PyInstaller doesn't bail.
$sp = (python -c "import sysconfig; print(sysconfig.get_paths()['purelib'])").Trim()
$stub = Join-Path $sp "webrtcvad-2.0.10.dist-info"
if (-not (Test-Path $stub)) {
    New-Item -ItemType Directory -Force -Path $stub | Out-Null
    Set-Content -Path (Join-Path $stub "METADATA") -Value @"
Metadata-Version: 2.1
Name: webrtcvad
Version: 2.0.10
Summary: Stub metadata pointing at the webrtcvad-wheels install.
"@
    Set-Content -Path (Join-Path $stub "WHEEL") -Value "Wheel-Version: 1.0`nGenerator: jarvis-build-stub"
    Set-Content -Path (Join-Path $stub "RECORD") -Value ""
    Set-Content -Path (Join-Path $stub "top_level.txt") -Value "webrtcvad"
    Write-Host "Created webrtcvad metadata stub at $stub"
}

Remove-Item -Recurse -Force build, dist -ErrorAction SilentlyContinue

$collect = @(
    "webview",
    "whisper",
    "kokoro",
    "orpheus_tts",
    "vllm",
    "torch",
    "transformers",
    "spacy",
    "misaki",
    "phonemizer",
    "phonemizer_fork",
    "espeakng_loader",
    "PyQt6",
    "soundfile",
    "en_core_web_sm",
    "language_tags",
    "csvw",
    "segments"
)
$collectArgs = $collect | ForEach-Object { "--collect-all=$_" }

# Hidden imports PyInstaller's static analysis sometimes misses.
# - httpx_sse: only referenced via from-import inside a method body
# - dotenv:    optional load_dotenv path
# - pynput:    imported lazily inside _setup_global_hotkey
$hiddenImports = @(
    "httpx_sse",
    "dotenv",
    "pynput",
    "pynput.keyboard",
    "torch_directml",
    "en_core_web_sm"
)
$hiddenArgs = $hiddenImports | ForEach-Object { "--hidden-import=$_" }

# Trim torch and friends that we definitely don't ship. Saves ~200-400MB.
# torch._numpy and torch._dynamo MUST be excluded: torch._numpy._ufuncs.py
# has a broken `vars()[name] = ...` loop that raises NameError under
# PyInstaller's frozen exec, and transformers pulls it in via
# `torch.compiler.disable` -> `torch._dynamo` -> `torch._numpy`. Excluding
# these breaks the import chain before the bug fires; we don't need JIT
# compilation for inference anyway.
$excludeModules = @(
    "torch._numpy",
    "torch._dynamo",
    "torch.compiler",
    "torch.distributions",
    "torch.testing",
    "torch.utils.tensorboard",
    "torchvision",
    "torchaudio",
    "tensorflow",
    "matplotlib",
    "pandas",
    "scipy",
    "IPython",
    "notebook",
    "jupyter"
)
$excludeArgs = $excludeModules | ForEach-Object { "--exclude-module=$_" }

$dataArgs = @(
    "--add-data=ui/jarvis.html;ui",
    "--add-data=ui/vendor;ui/vendor",
    "--add-data=config/settings.yaml;config"
)
if (Test-Path ".env") {
    $dataArgs += "--add-data=.env;."
}

# Jarvis app (GUI, no console). --onedir, NOT --onefile: QtWebEngine spawns
# separate GPU/renderer processes that need to find their sibling DLLs at
# stable paths. With --onefile the whole bundle is re-extracted to a fresh
# %TEMP%\_MEIxxxxxx on every launch, Chromium subprocesses can't reliably
# locate peer DLLs and fall back to software WebGL -- jarvis renders at
# <5fps. --onedir keeps everything in dist\Jarvis\ so the launches reuse
# warm caches and the GPU process finds D3D11.
python -m PyInstaller --noconfirm --clean `
    --name Jarvis `
    --windowed `
    --onedir `
    --icon "ui\jarvis.ico" `
    @dataArgs `
    @collectArgs `
    @hiddenArgs `
    @excludeArgs `
    main.py
if ($LASTEXITCODE -ne 0) { throw "Jarvis build failed" }

$setupDataArgs = @("--add-data=config/settings.yaml;config")
if (Test-Path ".env") {
    $setupDataArgs += "--add-data=.env;."
}

# Setup wizard (GUI; no console). Setup is small and rarely-launched so
# --onefile is fine here -- no QtWebEngine, just plain Qt widgets.
python -m PyInstaller --noconfirm --clean `
    --name JarvisSetup `
    --windowed `
    --onefile `
    --icon "ui\jarvis.ico" `
    @setupDataArgs `
    "--collect-all=PyQt6" `
    setup.py
if ($LASTEXITCODE -ne 0) { throw "JarvisSetup build failed" }

# Bundle into an installer that drops everything into %LOCALAPPDATA%\Jarvis.
# Inno Setup is free (https://jrsoftware.org/isdl.php). Detect ISCC.exe in
# PATH or in the standard install location; if absent, leave dist\ as-is and
# tell the user.
$iscc = $null
$candidates = @(
    "ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
)
foreach ($c in $candidates) {
    $found = Get-Command $c -ErrorAction SilentlyContinue
    if ($found) { $iscc = $found.Source; break }
    if (Test-Path $c) { $iscc = $c; break }
}

if ($iscc) {
    Write-Host ""
    Write-Host "Compiling installer with $iscc..."
    & $iscc "installer.iss"
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup compile failed" }
    Write-Host ""
    Write-Host "Built:"
    Write-Host "  dist\JarvisInstaller.exe  (single-file installer -- distribute this)"
    Write-Host "  dist\Jarvis\              (raw onedir build, for testing)"
    Write-Host "  dist\JarvisSetup.exe      (raw setup wizard, also bundled inside the installer)"
} else {
    Write-Host ""
    Write-Host "WARNING: Inno Setup (ISCC.exe) not found in PATH or under Program Files."
    Write-Host "Install from https://jrsoftware.org/isdl.php to produce the single-file installer."
    Write-Host ""
    Write-Host "Built (raw, no installer):"
    Write-Host "  dist\Jarvis\Jarvis.exe   (main app -- keep the folder together)"
    Write-Host "  dist\JarvisSetup.exe     (first-run setup, single file)"
}
