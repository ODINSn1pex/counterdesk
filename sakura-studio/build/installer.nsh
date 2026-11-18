; Standard-Installationsordner: Desktop\Sakura Studio
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$DESKTOP\Sakura Studio"
  SetRegView 32
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$DESKTOP\Sakura Studio"
!macroend
