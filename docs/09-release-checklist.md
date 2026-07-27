# 发布检查表

更新时间：2026-07-27  
适用版本：iTerm 0.x

发布负责人应复制本清单到对应 Release、Issue 或发布记录中填写。没有真实执行的项目不得
勾选；硬件、签名和外部互操作项不能用“代码已实现”代替。

## 1. 范围与版本

- [ ] 确认本次版本范围、目标用户和已知限制；
- [ ] `CHANGELOG.md` 已把本次条目从 `Unreleased` 移到版本号和发布日期下；
- [ ] `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 版本一致；
- [ ] `pnpm version:check` 通过；
- [ ] README 的下载、安装、限制和隐私说明与本版本一致；
- [ ] 功能矩阵没有把待硬件验证功能标为已验证；
- [ ] 当前分支没有无关改动或未提交文件。

版本号遵循语义化版本。`0.x` 阶段新增向后兼容功能提升次版本，纯修复提升修订版本。

## 2. 自动化质量门禁

本地按顺序执行：

```bash
pnpm install --frozen-lockfile
pnpm version:check
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
pnpm test
pnpm test:e2e
pnpm bench:terminal:smoke
pnpm build
pnpm sbom:generate
pnpm tauri:build
```

- [ ] Rust 格式检查通过；
- [ ] Rust 后端测试通过；
- [ ] Vitest 前端测试通过；
- [ ] Chromium 工作区 E2E 通过；
- [ ] 终端性能烟雾测试通过；
- [ ] 前端生产构建无错误和超限块警告；
- [ ] CycloneDX SBOM 成功生成且组件数量非零；
- [ ] 当前平台原生安装包成功生成；
- [ ] `main` 分支 GitHub CI 的质量和三平台桌面编译全部通过。

## 3. 人工与外部验收

### 核心工作区

- [ ] 新建、保存、复制、删除 Serial/SSH/ADB 会话；
- [ ] 多标签、标签列表、分屏、同步输入和工作区恢复；
- [ ] 中英文、浅色/深色/跟随系统和快捷键；
- [ ] Text/Hex 接收、终端搜索、复制粘贴和复位；
- [ ] 日志、配置导入导出和诊断导出。

### 串口硬件

- [ ] FTDI FT232；
- [ ] Silicon Labs CP210x；
- [ ] WCH CH340/341；
- [ ] 目标平台的枚举、打开、全字节收发、DTR、RTS、Break 和清缓冲；
- [ ] 占用、拔插、端口号变化、睡眠唤醒和自动重连；
- [ ] 30 分钟高吞吐、1 小时高频循环发送和 24 小时稳定性。

### 外部互操作

- [ ] OpenSSH Agent、默认密钥、指定私钥、密码交互和主机密钥校验；
- [ ] ADB USB 真机、unauthorized/offline 状态和网络 ADB；
- [ ] XModem-CRC 与目标 Bootloader/参考实现；
- [ ] YModem 多文件发送与接收；
- [ ] ZModem 与 `lrzsz` 的 `rz`/`sz` 双向互传。

无法完成的外部验收必须记录平台、缺少的硬件/服务、风险和负责人，不得静默跳过。

## 4. 安全、隐私和合规

- [ ] 诊断导出不含终端收发内容、凭据和文件内容；
- [ ] 会话/发送器导出已提示可能包含主机、设备和命令信息；
- [ ] 日志默认关闭，轮转和目录限制有效；
- [ ] 接收文件名不能越出用户选择目录；
- [ ] SBOM 随 Release 上传；
- [ ] 第三方组件声明与依赖版本一致；
- [ ] 项目许可证和产品名称/商标已由所有者确认；
- [ ] Apple 签名和公证已完成，或 Release 明确标记未签名；
- [ ] Windows 签名已完成，或 Release 明确标记未签名；
- [ ] 发布所用凭据只存在于 GitHub Secrets 或受控签名环境。

## 5. 发布

1. 把本地提交推送到 `main`；
2. 等待 `main` 的 CI 全部成功；
3. 创建与版本一致的带说明标签，例如：

   ```bash
   git tag -a v0.5.0 -m "发布 iTerm v0.5.0"
   git push origin v0.5.0
   ```

4. 等待 Release 工作流完成；
5. 核验 Release 页面和下载文件。

发布后检查：

- [ ] macOS Apple Silicon DMG；
- [ ] macOS Intel DMG；
- [ ] Windows x64 NSIS 安装程序；
- [ ] Linux x64 AppImage；
- [ ] Linux x64 Debian 软件包；
- [ ] `iTerm-vX.Y.Z.cdx.json`；
- [ ] Release 标题、变更说明和未签名提示；
- [ ] 最新版本徽章和 README 下载链接；
- [ ] 至少抽取一个安装包完成下载、安装、启动和版本核对。

## 6. 异常与回滚

- 构建失败：不手工上传未经同等检查的替代包，先修复并重新创建补丁版本；
- 单个平台失败：Release 保持未完成状态，记录失败平台，不把缺件版本标为完成；
- 错误标签：在没有用户下载前可删除错误 Release 和远端标签，修正版本后重新发布；
- 已被用户下载：不要用同一版本号静默替换二进制，发布新的补丁版本并说明影响；
- 安全问题：立即撤下受影响资产，发布公告和修复版本，并轮换可能泄露的凭据；
- 配置迁移问题：保留旧安装包和恢复说明，禁止执行不可逆的数据删除。

