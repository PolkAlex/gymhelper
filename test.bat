@echo off
cd /d %~dp0
echo [1/4] JS syntax...
node --check web\app.js || exit /b 1
node --check web\catalog.js || exit /b 1

echo [2/4] Static checks (fields, ACTIONS, catalog)...
node tests\check.js || exit /b 1

echo [3/4] Compile Java...
dir /s /b src\*.java > sources.txt
javac -encoding UTF-8 -d out @sources.txt || exit /b 1

echo [4/4] Data contract test (app ^<-^> server)...
javac -encoding UTF-8 -cp out -d testout tests\GymContractTest.java || exit /b 1
java -cp "out;testout" GymContractTest || exit /b 1

echo.
echo ALL TESTS PASSED
pause
