# 提交前检查（Windows 版）

**用途**：每次 `git commit` 时自动跑 typecheck + 单元测试，不过就不让提交。
**只跑这些**：页面校对脚本很慢，按规矩等需求方验收后再跑，不进这个钩子。

## 一次性安装（在本仓库根目录执行一次）

```powershell
git config core.hooksPath .githooks
```

装完就生效，以后每次提交都会检查。检查通过了才真正提交。

## 临时跳过

```powershell
git commit --no-verify -m "..."
```

**什么时候该跳过**：只是改文档、改注释这种不可能影响计算和类型的改动，或者你在排查环境问题。
**什么时候不该跳过**：改了任何 `.ts` 代码。

## 它检查什么

| 步骤 | 命令 | 不过的后果 |
|---|---|---|
| 类型检查 | `npm run typecheck` | 打印出错的文件与行号，拒绝提交 |
| 单元测试 | `node --test --experimental-strip-types --test-isolation=none "packages/*/test/**/*.test.ts"` | 打印失败的用例，拒绝提交 |

## 换机器 / 新克隆仓库后要重做

`.githooks/` 里的脚本是入库的，但 `core.hooksPath` 是本机 git 配置，**新克隆的仓库要再执行一次上面那条命令**。
