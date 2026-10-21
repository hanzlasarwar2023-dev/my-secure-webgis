@echo off
title PU WebGIS Server
cd /d C:\Users\hanzl\webgis-api

if not exist ".env" (
  echo [INFO] .env nahi mila - .env.example se copy ho raha hai.
  echo [INFO] Us mein JWT_SECRET aur DB_PASSWORD zaroor bharein.
  copy /Y ".env.example" ".env" >nul
)

echo.
echo [INFO] PU WebGIS start ho raha hai - http://localhost:3000
echo [INFO] Band karne ke liye Ctrl+C
echo.

start "" cmd /c "timeout /t 3 >nul & start http://localhost:3000/"

node server.js
pause
