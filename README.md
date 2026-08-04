# Secure Codex Provider Switcher（非官方）

一个仅限 Windows 的 VS Code 扩展，用于在以下两种 Codex 连接之间切换：

- 已登录的 ChatGPT 账户；
- 你自行选择并信任的 OpenAI-compatible HTTPS Responses API。

本扩展不是 OpenAI 官方产品，也不隶属于 OpenAI。

## 安全设计

- **无内置服务商**：安装包不包含任何真实 API 地址、请求头、账号或密钥。
- **仅允许 HTTPS**：拒绝明文 HTTP、URL 内嵌凭据、查询参数和片段。
- **确认目标主机**：首次配置或更换地址时，明确显示 API Key 将被发送到的主机。
- **DPAPI 加密**：API Key 由 Windows DPAPI 以当前 Windows 用户身份加密。
- **密钥绑定地址**：加密密钥与完整 HTTPS Base URL 绑定；地址变化后必须重新输入密钥。
- **配置防篡改检查**：读取密钥前核对 `config.toml` 中的实际 Base URL。
- **不使用 Bypass**：PowerShell 子进程使用 `RemoteSigned`，不会关闭脚本签名策略。
- **零遥测**：扩展自身不发送网络请求，不收集遥测，也没有自定义更新通道。
- **不修改官方扩展**：公开版不会改写 OpenAI Codex 扩展的代码或资源文件。

Marketplace 版本应由 Visual Studio Marketplace 签名。不要关闭 VS Code 的扩展签名校验，也不要从不可信镜像安装。

## 使用

1. 安装官方 OpenAI Codex 扩展并登录 ChatGPT。
2. 运行 `Codex: 配置自定义 API`。
3. 输入可信的 HTTPS Base URL、模型 ID 和 API Key。
4. 仔细核对确认框中的主机名。
5. 运行 `Codex: 切换账户 / 自定义 API`。

切换器只管理自己的配置区块，并保留 ChatGPT 登录。API Key 不写入 `config.toml`。

## 本地文件

- 设置：`~/.codex/lab-provider-switcher/settings.json`
- 加密密钥：`~/.codex/lab-provider-switcher/api-key.v2.dpapi`
- 初始备份：`~/.codex/config.toml.before-provider-switcher`
- 最近备份：`~/.codex/config.toml.provider-switcher-last.bak`

这些文件不会被打进 VSIX，也不会由本扩展上传。

## 兼容要求

- Windows 10/11；
- VS Code 1.96 或更高版本；
- 官方 OpenAI Codex VS Code 扩展；
- 支持 `POST <base_url>/responses`、SSE 流式输出和工具调用的 HTTPS 服务。

## 安全边界

HTTPS 能防止常见网络窃听和篡改，但扩展无法保护你免受以下情况影响：服务方自身被入侵、系统信任库中存在恶意根证书、同一 Windows 用户下运行的恶意软件或其他恶意 VS Code 扩展。详见 [SECURITY.md](SECURITY.md)。

## 开发

```powershell
npm ci
npm run verify
npm run package
```

## License

MIT
