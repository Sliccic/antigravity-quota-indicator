@echo off
chcp 65001 >nul
title Antigravity 模型余量插件一键安装器

echo ========================================================
echo   ⚡ Antigravity 实时模型用量与配额指示器一键安装器
echo ========================================================
echo.

node bin/cli.js install

echo.
echo 按任意键退出...
pause >nul
