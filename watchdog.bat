@echo off
cd /d "%~dp0"
node eval\watchdog.js >> eval\watchdog-log.txt 2>&1
