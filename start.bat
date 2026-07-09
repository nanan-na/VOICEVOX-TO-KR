@echo off
chcp 65001 >nul
cd /d "%~dp0"
rem k2v 원클릭 실행 (기획서 9.6): VOICEVOX ENGINE 확인 → 웹 서버 → 브라우저

curl -s -o nul http://127.0.0.1:50021/version
if errorlevel 1 (
  echo VOICEVOX ENGINE 시작 중...
  start "" "%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe" --host 127.0.0.1
  :wait_engine
  timeout /t 2 /nobreak >nul
  curl -s -o nul http://127.0.0.1:50021/version
  if errorlevel 1 goto wait_engine
)
echo VOICEVOX ENGINE 연결됨.

rem 서버가 뜬 뒤 브라우저가 열리도록 2초 지연
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://127.0.0.1:8300"
echo k2v 서버 시작 (이 창을 닫으면 종료됩니다)
node server.js
