@echo off
setlocal EnableDelayedExpansion
rem NodeDR POS - operator command line.
rem Wraps the handful of sc.exe / service calls a shopkeeper or a sysadmin
rem actually needs, so neither has to remember Windows service names.

set "APP_DIR=%~dp0.."
set "DATA_DIR=C:\ProgramData\NodeDRPOS"
set "NODE=%APP_DIR%\runtime\node.exe"
set "SVC_BACKEND=NodeDRPOSBackend"
set "SVC_FRONTEND=NodeDRPOSFrontend"
set "PORT=1994"

if "%~1"=="" goto :usage
if /I "%~1"=="help"    goto :usage
if /I "%~1"=="--help"  goto :usage
if /I "%~1"=="/?"      goto :usage

if /I "%~1"=="open"    goto :open
if /I "%~1"=="url"     goto :url
if /I "%~1"=="status"  goto :status
if /I "%~1"=="start"   goto :start
if /I "%~1"=="stop"    goto :stop
if /I "%~1"=="restart" goto :restart
if /I "%~1"=="logs"    goto :logs
if /I "%~1"=="doctor"  goto :doctor
if /I "%~1"=="backup"  goto :backup
if /I "%~1"=="version" goto :version

echo Unknown command: %~1
echo.
goto :usage

:usage
echo NodeDR POS - offline point-of-sale
echo.
echo Usage: nodedr-pos ^<command^>
echo.
echo   open                Open the POS in your browser
echo   url                 Print the address to open
echo   start ^| stop ^| restart   Control the POS services   [admin]
echo   status              Show whether the services are running
echo   logs                Open the log folder
echo   doctor              Check services, port and database
echo   backup [file]       Safe online copy of the database  [admin]
echo   version             Show installed version
echo.
echo Data folder: %DATA_DIR%
exit /b 0

:url
echo http://localhost:%PORT%
exit /b 0

:open
rem Nudge the services up if they are stopped - a user double-clicking the
rem shortcut means "I want the POS", not "show me a connection error".
sc query "%SVC_FRONTEND%" | find "RUNNING" >nul 2>&1
if errorlevel 1 (
  net start "%SVC_BACKEND%"  >nul 2>&1
  net start "%SVC_FRONTEND%" >nul 2>&1
)
rem Wait for the port to actually accept connections before handing it to the
rem browser, so a click right after boot doesn't land on an error page.
for /L %%i in (1,1,45) do (
  "%NODE%" -e "const n=require('net'),s=n.connect(%PORT%,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),900)" >nul 2>&1
  if !errorlevel! EQU 0 (
    start "" "http://localhost:%PORT%"
    exit /b 0
  )
  timeout /t 1 /nobreak >nul
)
echo NodeDR POS is not responding on port %PORT%.
echo Check it with:  nodedr-pos doctor
exit /b 1

:status
sc query "%SVC_BACKEND%"  | find /I "STATE"
sc query "%SVC_FRONTEND%" | find /I "STATE"
exit /b 0

:start
net start "%SVC_BACKEND%"
net start "%SVC_FRONTEND%"
echo Started. http://localhost:%PORT%
exit /b 0

:stop
net stop "%SVC_FRONTEND%" 2>nul
net stop "%SVC_BACKEND%"  2>nul
echo Stopped.
exit /b 0

:restart
net stop "%SVC_FRONTEND%" 2>nul
net stop "%SVC_BACKEND%"  2>nul
net start "%SVC_BACKEND%"
net start "%SVC_FRONTEND%"
echo Restarted. http://localhost:%PORT%
exit /b 0

:logs
if exist "%DATA_DIR%\logs" (
  start "" explorer "%DATA_DIR%\logs"
) else (
  echo No log folder yet at %DATA_DIR%\logs
)
exit /b 0

:doctor
echo NodeDR POS health check
echo -----------------------
set "RC=0"
sc query "%SVC_BACKEND%" | find "RUNNING" >nul 2>&1
if errorlevel 1 (echo   [FAIL] API service is not running & set "RC=1") else (echo   [ ok ] API service running)
sc query "%SVC_FRONTEND%" | find "RUNNING" >nul 2>&1
if errorlevel 1 (echo   [FAIL] web service is not running & set "RC=1") else (echo   [ ok ] web service running)

"%NODE%" -e "const n=require('net'),s=n.connect(%PORT%,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),1500)" >nul 2>&1
if errorlevel 1 (echo   [FAIL] nothing listening on port %PORT% & set "RC=1") else (echo   [ ok ] web interface listening on %PORT%)

if exist "%DATA_DIR%\pos.db" (echo   [ ok ] database present) else (echo   [warn] no database yet - open the POS to run first-time setup)
echo.
echo Open the POS at: http://localhost:%PORT%
if "%RC%"=="1" echo Something is wrong - see: nodedr-pos logs
exit /b %RC%

:backup
set "DEST=%~2"
if "%DEST%"=="" (
  for /f "tokens=2 delims==" %%t in ('wmic os get localdatetime /value ^| find "="') do set "TS=%%t"
  set "DEST=%DATA_DIR%\backups\pos-!TS:~0,8!-!TS:~8,6!.db"
)
if not exist "%DATA_DIR%\backups" mkdir "%DATA_DIR%\backups"
if not exist "%DATA_DIR%\pos.db" (
  echo No database at %DATA_DIR%\pos.db - has the POS been set up yet?
  exit /b 1
)
rem VACUUM INTO is an online, crash-consistent copy: safe while the shop is
rem trading, unlike copying a live SQLite file.
"%NODE%" -e "const D=require('%APP_DIR:\=/%/backend/node_modules/better-sqlite3');const db=new D(process.argv[1],{readonly:true,fileMustExist:true});db.prepare('VACUUM INTO ?').run(process.argv[2]);db.close();" "%DATA_DIR%\pos.db" "%DEST%"
if errorlevel 1 (echo Backup failed. & exit /b 1)
echo Backup written to %DEST%
exit /b 0

:version
if exist "%NODE%" ("%NODE%" -v) else (echo node runtime missing)
echo Data folder: %DATA_DIR%
exit /b 0
