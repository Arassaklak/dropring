; DropRing — Windows kurulum eklentileri:
;  * Gezgin sağ tık menüsü: "DropRing ile dönüştür" (tüm dosyalar ve klasörler, kullanıcı başına, yönetici gerekmez)
;  * dropring komutunu kullanıcı PATH'ine ekleme
!ifndef BUILD_UNINSTALLER
  !include "StrFunc.nsh"
  ${StrStr}
!endif

!macro customInstall
  WriteRegStr HKCU "Software\Classes\*\shell\DropRing" "" "DropRing ile dönüştür"
  WriteRegStr HKCU "Software\Classes\*\shell\DropRing" "Icon" "$INSTDIR\DropRing.exe,0"
  WriteRegStr HKCU "Software\Classes\*\shell\DropRing" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\*\shell\DropRing\command" "" '"$INSTDIR\DropRing.exe" --open "%1"'
  WriteRegStr HKCU "Software\Classes\Directory\shell\DropRing" "" "DropRing ile ZIP yap"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DropRing" "Icon" "$INSTDIR\DropRing.exe,0"
  WriteRegStr HKCU "Software\Classes\Directory\shell\DropRing\command" "" '"$INSTDIR\DropRing.exe" --open "%1"'
  ; PATH'e ekle (zaten varsa ekleme)
  ReadRegStr $0 HKCU "Environment" "Path"
  ${StrStr} $1 "$0" "$INSTDIR"
  StrCmp $1 "" 0 dropring_path_done
    StrCmp $0 "" 0 +3
      WriteRegExpandStr HKCU "Environment" "Path" "$INSTDIR"
      Goto dropring_path_done
    WriteRegExpandStr HKCU "Environment" "Path" "$0;$INSTDIR"
  dropring_path_done:
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=500
!macroend

!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\*\shell\DropRing"
  DeleteRegKey HKCU "Software\Classes\Directory\shell\DropRing"
!macroend
