@echo off
chcp 65001 >nul
cd /d C:\Users\Lenovo\IdeaProjects\MyHelper

echo [1/6] JS syntax check...
node --check web\app.js
if errorlevel 1 goto :fail
node --check web\catalog.js
if errorlevel 1 goto :fail

echo [2/6] Static checks (fields, handlers, catalog)...
node tests\check.js
if errorlevel 1 goto :fail

echo [3/6] Compile Java...
dir /s /b src\*.java > sources.txt
javac -encoding UTF-8 -d out @sources.txt
if errorlevel 1 goto :fail

echo [4/6] Data contract test...
javac -encoding UTF-8 -cp out -d testout tests\GymContractTest.java
if errorlevel 1 goto :fail
java -cp "out;testout" GymContractTest
if errorlevel 1 goto :fail

echo [5/6] Uploading to server...
scp -r src web root@45.91.169.125:/opt/gym/
if errorlevel 1 goto :fail

echo [6/6] Remote compile and restart...
ssh root@45.91.169.125 "cd /opt/gym && javac -encoding UTF-8 -d out $(find src -name '*.java') && systemctl restart gymbot"
if errorlevel 1 goto :fail

echo.
echo ============================================
echo   DONE! Tests passed, bot updated.
echo ============================================
pause
exit /b 0

:fail
echo.
echo ============================================
echo   FAILED! Server was NOT touched.
echo   Fix errors above and run again.
echo ============================================
pause
exit /b 1
