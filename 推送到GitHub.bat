@echo off
rem =====================================================================
rem  PanelForge - push to GitHub  (double-click me)
rem  ASCII only: cmd.exe parses .bat in the OEM codepage.
rem  step 1: create an EMPTY repo on github.com (no README / no .gitignore)
rem  step 2: double-click this file, paste the repo URL, log in in browser
rem =====================================================================
setlocal enabledelayedexpansion
title PanelForge - push to GitHub
cd /d "%~dp0"

set "BRANCH=main"
set "CHECK_ONLY=0"
if /i "%~1"=="--check" set "CHECK_ONLY=1"

echo.
echo   ============================================
echo    PanelForge  -  push this repo to GitHub
echo   ============================================
echo.

rem ---------- 0. sanity ----------
if not exist ".git" (
  echo   [ERROR] no .git here. Run: git init -b main
  goto end_pause
)
git rev-parse --verify HEAD >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] no commit yet.
  goto end_pause
)
for /f "delims=" %%b in ('git branch --show-current') do set "CUR=%%b"
if not "%CUR%"=="%BRANCH%" git branch -M %BRANCH%

echo   commits :
set "NCOMMITS="
for /f %%c in ('git rev-list --count HEAD') do set "NCOMMITS=%%c"
echo   %NCOMMITS%
for /f %%c in ('powershell -NoProfile -Command "(git ls-files).Count"') do echo   files   : %%c
echo.

rem ---------- 1. remote ----------
set "REMOTE="
for /f "delims=" %%r in ('git remote get-url origin 2^>nul') do set "REMOTE=%%r"
if defined REMOTE goto have_remote

if not "%~2"=="" (
  git remote add origin "%~2"
  set "REMOTE=%~2"
  echo   Step 1/3  origin = %~2
  echo   [ok] remote added
  goto remote_done
)

if "%CHECK_ONLY%"=="1" (
  echo   Step 1/3  no remote yet.
  echo   [check] everything else is ready. Usage:
  echo           this-file.bat             ^(will ask for the URL^)
  echo           this-file.bat --check URL
  goto end_pause
)

echo   Step 1/3  Repo URL
echo   ------------------------------------------------------
echo   Open https://github.com/new , create an EMPTY repo
echo   (do NOT tick README / .gitignore / license), then paste
echo   its URL here, e.g.
echo      https://github.com/yourname/panel-forge.git
echo.
set /p "INPUT_URL=   URL (empty = cancel): "
if "%INPUT_URL%"=="" goto cancelled
git remote add origin "%INPUT_URL%"
if errorlevel 1 goto remote_failed
set "REMOTE=%INPUT_URL%"
echo   [ok] origin = %REMOTE%
goto remote_done

:have_remote
echo   Step 1/3  remote already set: %REMOTE%

:remote_done
echo.

rem ---------- 2. identity ----------
set "GIT_NAME="
set "GIT_MAIL="
for /f "delims=" %%n in ('git config user.name 2^>nul') do set "GIT_NAME=%%n"
for /f "delims=" %%m in ('git config user.email 2^>nul') do set "GIT_MAIL=%%m"
rem the placeholder identity this repo was prepared with -> ask for the real one
if /i "%GIT_NAME%"=="PanelForge" set "GIT_NAME="
if /i "%GIT_MAIL%"=="panel-forge@users.noreply.github.com" set "GIT_MAIL="
if not "%GIT_NAME%"=="" if not "%GIT_MAIL%"=="" goto identity_done

echo   Step 2/3  Your git identity (stored in this repo only)
echo   ------------------------------------------------------
echo   Current: name=[%GIT_NAME%] email=[%GIT_MAIL%]
set /p "INPUT_NAME=   Your name  (empty = keep): "
set /p "INPUT_MAIL=   Your email (empty = keep): "
if not "%INPUT_NAME%"=="" git config user.name "%INPUT_NAME%"
if not "%INPUT_MAIL%"=="" git config user.email "%INPUT_MAIL%"
echo   [ok] identity set
echo.
echo   Optional: rewrite the %NCOMMITS% existing commits so they are authored by you.
echo   Safe here because the repo has not been pushed yet.
set /p "RE_AUTHOR=   re-author existing commits? (y/N): "
if /i not "%RE_AUTHOR%"=="y" goto identity_done
git rebase --root --exec "git commit --amend --no-edit --reset-author" >nul 2>nul
if errorlevel 1 (
  echo   [warn] re-author failed, history kept as-is.
  git rebase --abort >nul 2>nul
) else (
  echo   [ok] all commits re-authored
)

:identity_done
echo.

rem ---------- 3. push ----------
echo   Step 3/3  push
echo   ------------------------------------------------------
echo   A browser window will pop up for GitHub login.
echo.
if "%CHECK_ONLY%"=="1" (
  echo   [check] remote + identity + commits all ready.
  echo   [check] would run: git push -u origin %BRANCH%
  goto end_pause
)

git push -u origin %BRANCH%
if errorlevel 1 goto push_failed

echo.
echo   ============================================
echo    Pushed. Repo: %REMOTE%
echo   ============================================
echo.
echo   Next, optional but recommended:
echo.
echo   1) Free public site (GitHub Pages, static version)
echo      Repo -^> Settings -^> Pages -^> Source: GitHub Actions
echo      Then: Actions tab, wait ~1 min. URL:
echo      https://USERNAME.github.io/REPO/
echo.
echo   2) Full version with API + AI director (Render, free tier)
echo      https://render.com -^> New -^> Blueprint -^> pick this repo
echo      render.yaml is already in the repo.
echo.
goto end_pause

:push_failed
echo.
echo   [FAILED] push rejected. Two common causes:
echo.
echo   a) The remote repo is NOT empty (has README etc). Fix:
echo        git pull --rebase origin %BRANCH%
echo        git push -u origin %BRANCH%
echo   b) Login cancelled or wrong account. Retry the same script;
echo      Windows Credential Manager will ask again.
echo.
echo   You can also check the account git will use:
echo        git config --get credential.username
echo.
goto end_pause

:remote_failed
echo   [ERROR] could not add remote. Run manually:
echo      git remote add origin URL
goto end_pause

:cancelled
echo   cancelled.
goto end_pause

:end_pause
echo.
pause
exit /b 0
