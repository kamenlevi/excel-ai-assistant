@echo off
cd /d "%~dp0"
node eval\run.js >> eval\eval-log.txt 2>&1
