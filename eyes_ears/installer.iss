; Jarvis installer -- bundles dist\Jarvis\ + dist\JarvisSetup.exe into a
; single .exe. Defaults to Program Files\Jarvis (machine-wide install,
; requires admin), but the user can pick any directory at install time.
; Run with Inno Setup 6+:  ISCC.exe installer.iss

#define MyAppName        "Jarvis"
#define MyAppPublisher   "Dockbox"
#define MyAppExeName     "Jarvis.exe"
#define MySetupExeName   "JarvisSetup.exe"

[Setup]
AppId={{B5C71D2F-9B8E-4C1F-9B21-8F9DC4F8A1E3}
AppName={#MyAppName}
AppVersion=1.0.0
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
; Show the directory-pick page so users can install elsewhere.
DisableDirPage=no
; Always show the program-group page so users can rename or skip Start menu.
DisableProgramGroupPage=no
; AllowNoIcons lets users opt out of Start menu shortcuts entirely.
AllowNoIcons=yes
; Default to a per-machine install (Program Files) -- needs admin elevation.
PrivilegesRequired=admin
PrivilegesRequiredOverridesAllowed=dialog
; Force 64-bit install on x64 Windows so {autopf} = "Program Files" (no
; parentheses). Path with "(x86)" can trip Chromium/QtWebEngine subprocess
; spawn argv parsing and surface as "qt platform plugin not found" even
; though the DLL is present.
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
OutputDir=dist
OutputBaseFilename=JarvisInstaller
SetupIconFile=ui\jarvis.ico
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#MyAppExeName}

[Files]
; Main exe at the top of the install folder.
Source: "dist\Jarvis\Jarvis.exe"; DestDir: "{app}"; Flags: ignoreversion
; Setup wizard (single-file) sits next to it.
Source: "dist\{#MySetupExeName}";  DestDir: "{app}"; Flags: ignoreversion
; Everything PyInstaller puts in `_internal\` (DLLs, resources, models). We
; keep PyInstaller's default folder name -- renaming it (e.g. via
; --contents-directory) breaks Qt's QtWebEngine plugin path resolution and
; the app won't launch. We also do NOT mark this folder hidden -- Qt's
; plugin loader and the QtWebEngine GPU subprocess can fail to enumerate a
; hidden directory on some Windows configurations, which surfaces as
; "qt platform plugin not found" at startup.
Source: "dist\Jarvis\_internal\*"; DestDir: "{app}\_internal"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}";           Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"
Name: "{group}\{#MyAppName} Setup";     Filename: "{app}\{#MySetupExeName}"
Name: "{group}\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}";     Filename: "{app}\{#MyAppExeName}"; WorkingDir: "{app}"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"
Name: "runsetup";    Description: "Run first-time setup now";  GroupDescription: "After install:"

[Run]
; First-time setup wizard (configures CF token, user id, group). Optional task.
Filename: "{app}\{#MySetupExeName}"; Description: "Run Jarvis Setup"; Flags: nowait postinstall skipifsilent; Tasks: runsetup

[UninstallDelete]
; %APPDATA%\Jarvis holds the user's session/config -- leave it on uninstall.
; If the user wants a clean wipe they can delete it manually.
