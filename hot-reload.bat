@echo off
chcp 65001 >nul
title Antigravity 模型余量插件即时热注入

echo ========================================================
echo   ⚡ Antigravity 模型余量指示器 - 零重启即时热注入
echo ========================================================
echo.

node bin/cli.js hot-reload

echo.
timeout /t 3 >nul
