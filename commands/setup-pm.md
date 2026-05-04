---
description: Configure your preferred package manager (npm/pnpm/yarn/bun)
disable-model-invocation: true
---

# Package Manager Setup

Configure your preferred package manager for this project or globally.

## Usage

```bash
PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require("path"),f=require("fs"),h=require("os").homedir(),a=[p.join(h,".claude"),p.join(h,".codex")],q=p.join("scripts","lib","utils.js");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],"plugins","oh-my-forge"),p.join(a[j],"plugins","oh-my-forge@rlagycks"),p.join(a[j],"plugins","marketplace","oh-my-forge"),p.join(a[j],"plugins","everything-claude-code"),p.join(a[j],"plugins","everything-claude-code@everything-claude-code"),p.join(a[j],"plugins","marketplace","everything-claude-code"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of ["oh-my-forge","everything-claude-code"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],"plugins","cache",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"

# Detect current package manager
node "$PLUGIN_ROOT/scripts/setup-package-manager.js" --detect

# Set global preference
node "$PLUGIN_ROOT/scripts/setup-package-manager.js" --global pnpm

# Set project preference
node "$PLUGIN_ROOT/scripts/setup-package-manager.js" --project bun

# List available package managers
node "$PLUGIN_ROOT/scripts/setup-package-manager.js" --list
```

## Detection Priority

When determining which package manager to use, the following order is checked:

1. **Environment variable**: `CLAUDE_PACKAGE_MANAGER`
2. **Project config**: `.claude/package-manager.json`
3. **package.json**: `packageManager` field
4. **Lock file**: Presence of package-lock.json, yarn.lock, pnpm-lock.yaml, or bun.lockb
5. **Global config**: `~/.claude/package-manager.json`
6. **Fallback**: First available package manager (pnpm > bun > yarn > npm)

## Configuration Files

### Global Configuration
```json
// ~/.claude/package-manager.json
{
  "packageManager": "pnpm"
}
```

### Project Configuration
```json
// .claude/package-manager.json
{
  "packageManager": "bun"
}
```

### package.json
```json
{
  "packageManager": "pnpm@8.6.0"
}
```

## Environment Variable

Set `CLAUDE_PACKAGE_MANAGER` to override all other detection methods:

```bash
# Windows (PowerShell)
$env:CLAUDE_PACKAGE_MANAGER = "pnpm"

# macOS/Linux
export CLAUDE_PACKAGE_MANAGER=pnpm
```

## Run the Detection

To see current package manager detection results, run:

```bash
PLUGIN_ROOT="$(node -p '(()=>{var e=(process.env.CLAUDE_PLUGIN_ROOT||process.env.CODEX_PLUGIN_ROOT);if(e&&e.trim())return e.trim();var p=require("path"),f=require("fs"),h=require("os").homedir(),a=[p.join(h,".claude"),p.join(h,".codex")],q=p.join("scripts","lib","utils.js");for(var i=0;i<a.length;i++){if(f.existsSync(p.join(a[i],q)))return a[i]}var r=[];for(var j=0;j<a.length;j++){r.push(p.join(a[j],"plugins","oh-my-forge"),p.join(a[j],"plugins","oh-my-forge@rlagycks"),p.join(a[j],"plugins","marketplace","oh-my-forge"),p.join(a[j],"plugins","everything-claude-code"),p.join(a[j],"plugins","everything-claude-code@everything-claude-code"),p.join(a[j],"plugins","marketplace","everything-claude-code"))}for(var k=0;k<r.length;k++){if(f.existsSync(p.join(r[k],q)))return r[k]}for(var n of ["oh-my-forge","everything-claude-code"]){for(var m=0;m<a.length;m++){try{var b=p.join(a[m],"plugins","cache",n),s=f.readdirSync(b,{withFileTypes:true});for(var o of s){if(!o.isDirectory())continue;var g=p.join(b,o.name),t=f.readdirSync(g,{withFileTypes:true});for(var v of t){if(!v.isDirectory())continue;var c=p.join(g,v.name);if(f.existsSync(p.join(c,q)))return c}}}catch(x){}}}return a[0]})()')"
node "$PLUGIN_ROOT/scripts/setup-package-manager.js" --detect
```
