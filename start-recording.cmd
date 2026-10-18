@echo off
rem DarkScan: record a shopping session. Double-click this file (Windows).
rem "start-recording.cmd --check" only checks that everything is installed.
setlocal
cd /d "%~dp0"
echo.
echo  DarkScan: record a shopping session
echo  -----------------------------------
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  Node.js is not installed. Install the "LTS" version from https://nodejs.org/ and run this again.
  pause
  exit /b 1
)
for /f "delims=v." %%a in ('node -v') do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 22 (
  echo  Your Node.js is too old. DarkScan needs version 22 or newer: install the "LTS" version from https://nodejs.org/.
  pause
  exit /b 1
)

if not exist node_modules (
  echo  First run: installing what DarkScan needs. This takes a minute or two.
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo  The install failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)
call npx --no-install playwright install chromium
if errorlevel 1 (
  echo  Could not set up the browser. Check your internet connection and try again.
  pause
  exit /b 1
)

if /i "%~1"=="--check" (
  echo  Everything is ready.
  exit /b 0
)

echo.
echo  What happens next:
echo    - A browser window opens. YOU shop in it as you normally would. DarkScan never clicks anything.
echo    - Stop before paying. Do not type card or bank details. Recording stops by itself at a payment page.
echo    - What you type is not saved, and emails, phone and card numbers are hidden in what is saved.
echo    - Names and addresses that the page shows are only hidden if you list them below.
echo    - When you are done, wait a second, then close the browser window.
echo.

rem The answers can also be preset with DARKSCAN_URL, DARKSCAN_HIDE and DARKSCAN_SHARE (y or n), to skip the questions.
set "SHOP=%DARKSCAN_URL%"
if not defined SHOP set /p "SHOP=  Shop address to start from (for example https://www.example.com/): "
if not defined SHOP exit /b 1
rem Compare the first characters rather than piping the address anywhere: shop addresses are full of & and ?
if /i not "%SHOP:~0,7%"=="http://" if /i not "%SHOP:~0,8%"=="https://" (
  echo  The address must start with http:// or https://
  if not defined DARKSCAN_URL pause
  exit /b 1
)

set "HIDE=%DARKSCAN_HIDE%"
if not defined DARKSCAN_HIDE set /p "HIDE=  Words to hide, such as your name, phone number or street (separate with commas, or press Enter to skip): "
set "SHARE=%DARKSCAN_SHARE%"
if not defined SHARE set /p "SHARE=  Also make a copy to send to the person running the study? (y/n): "

set ARGS=--url "%SHOP%" --site session
if defined HIDE set ARGS=%ARGS% --redact "%HIDE%"
if /i "%SHARE%"=="y" set ARGS=%ARGS% --share share
if defined DARKSCAN_HEADLESS set ARGS=%ARGS% --headless

if defined DARKSCAN_DRYRUN (
  echo  would run: record %ARGS%
  exit /b 0
)
call npm run record --silent -- %ARGS%

for /f "delims=" %%d in ('dir /b /ad /o-d runs 2^>nul') do (
  echo.
  echo  Opening your report: runs\%%d\report.html
  if not defined DARKSCAN_HEADLESS start "" "runs\%%d\report.html"
  goto :done
)
:done
if /i "%SHARE%"=="y" echo  The copy to send is in the "share" folder: zip the folder inside it and send that.
echo.
if not defined DARKSCAN_HEADLESS pause
