@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
rem k2v 원클릭 실행: 사전 점검 → VOICEVOX ENGINE 확인 → 웹 서버 → 브라우저

set "ENGINE_URL=http://127.0.0.1:50021/version"
set "WEB_URL=http://127.0.0.1:8300"
set "ENGINE_EXE=%LOCALAPPDATA%\Programs\VOICEVOX\vv-engine\run.exe"
set "ENGINE_TIMEOUT=90"

call :check_node
if errorlevel 1 goto :fail

call :check_port
if errorlevel 1 goto :fail

call :ensure_engine
if errorlevel 1 goto :fail

echo k2v 서버 시작 (이 창을 닫으면 종료됩니다)
start "" cmd /c "timeout /t 2 /nobreak >nul & start %WEB_URL%"
node server.js
if errorlevel 1 goto :fail
exit /b 0


:check_node
where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js를 찾을 수 없습니다.
  echo.
  echo        https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행해 주세요.
  exit /b 1
)
exit /b 0


:check_port
netstat -ano | findstr ":8300" | findstr "LISTENING" >nul
if not errorlevel 1 (
  echo [오류] 8300 포트를 이미 다른 프로그램이 사용 중입니다.
  echo.
  echo        k2v 창이 이미 열려 있지 않은지 확인해 주세요.
  echo        열려 있다면 새로 실행하실 필요 없이 %WEB_URL% 을 그대로 쓰시면 됩니다.
  exit /b 1
)
exit /b 0


:ensure_engine
curl -s -o nul -m 3 "%ENGINE_URL%"
if not errorlevel 1 (
  echo VOICEVOX ENGINE 연결됨.
  exit /b 0
)
if not exist "%ENGINE_EXE%" (
  echo [오류] VOICEVOX 엔진을 찾을 수 없습니다.
  echo        확인한 경로: %ENGINE_EXE%
  echo.
  echo        VOICEVOX가 설치되어 있지 않거나, 기본 경로가 아닌 곳에 설치된 것 같습니다.
  echo        기본 경로가 아니라면 VOICEVOX를 먼저 실행해 두신 뒤 이 파일을 다시 실행해 주세요.
  exit /b 1
)
echo VOICEVOX ENGINE 시작 중... ^(최대 %ENGINE_TIMEOUT%초^)
start "" "%ENGINE_EXE%" --host 127.0.0.1
powershell -NoProfile -Command "$end=(Get-Date).AddSeconds(%ENGINE_TIMEOUT%); while((Get-Date) -lt $end){ try{ Invoke-WebRequest -Uri '%ENGINE_URL%' -TimeoutSec 2 -UseBasicParsing | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } }; exit 1"
if errorlevel 1 (
  echo [오류] %ENGINE_TIMEOUT%초 안에 엔진이 응답하지 않았습니다.
  echo.
  echo        VOICEVOX를 직접 실행해 엔진이 정상적으로 뜨는지 확인한 뒤 다시 시도해 주세요.
  exit /b 1
)
echo VOICEVOX ENGINE 연결됨.
exit /b 0


:fail
echo.
echo 실행하지 못했습니다. 위 메시지를 확인해 주세요.
echo.
pause
exit /b 1
