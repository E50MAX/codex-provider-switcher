# Secure Codex Provider Switcher（非官方）

这是一个仅限 Windows 的 VS Code 扩展，用来在官方 Codex 的两种连接之间切换：

- 已登录的 ChatGPT 账户；
- 你自己信任的 HTTPS Responses API 中转站。

两种连接使用同一个 `CODEX_HOME`，并可在官方 Codex 中显示同一份本地历史列表。已有会话不需要导出、复制或迁移；切换连接后仍可找到并打开另一种连接创建的本地会话。

配置中转站时只需要填写 **HTTPS Base URL** 和 **API Key**。模型与推理等级不再手工输入，切换完成后直接在官方 Codex 输入框下方选择。

当前中转模式会显示 3 个模型：

- `gpt-5.6-sol`
- `gpt-5.6-terra`
- `gpt-5.6-luna`

本扩展不是 OpenAI 官方产品，也不隶属于 OpenAI。

## 一、安装前先准备官方 Codex

新电脑请严格按下面顺序操作，否则扩展可能找不到模型列表。

1. 打开 VS Code。
2. 点击左侧活动栏的 **扩展** 图标，也就是四个小方块。
3. 搜索 `openai.chatgpt`，安装发布者为 **OpenAI** 的官方 Codex 扩展。
4. 打开官方 Codex 面板，按提示登录 ChatGPT 账户。
5. 登录后打开一次新对话，并点一下输入框下方的模型名称，让官方 Codex 完成模型列表加载。
6. 如果刚登录完仍看不到模型，先执行一次 `Developer: Reload Window`，再重新打开 Codex。

这一步会让官方 Codex 在 `~/.codex/models_cache.json` 生成模型缓存。切换器从这个本地缓存生成中转模型菜单，不会上传缓存。

## 二、安装本扩展

### 方法 A：在 VS Code 扩展商店安装

1. 点击左侧 **扩展** 图标。
2. 搜索 `Secure Codex Provider Switcher`。
3. 确认发布者是 `e50max`。
4. 点击 **Install / 安装**。
5. 如果 VS Code 提示重载，点击 **Reload / 重载**。

也可以在终端安装：

```powershell
code --install-extension e50max.codex-provider-switcher
```

### 方法 B：安装 GitHub Release 里的 VSIX

1. 从 [GitHub Releases](https://github.com/E50MAX/codex-provider-switcher/releases) 下载最新版 `codex-provider-switcher.vsix`。
2. 回到 VS Code，打开左侧 **扩展**。
3. 点击扩展面板右上角的 `...`。
4. 点击 **Install from VSIX... / 从 VSIX 安装...**。
5. 选择刚下载的 VSIX，安装后重载 VS Code。

## 三、第一次启用账户 / API 共享历史

当前官方 Codex 会按 Provider 过滤本地历史，导致切换连接后只显示当前一侧的会话。本扩展启动后会检查官方 Codex 的历史查询结构；只有扩展主程序和唯一的历史面板资源都能通过严格校验时，才会显示确认框。

想让两边历史出现在同一列表：

1. 仔细阅读“让 ChatGPT 账户与自定义 API 共享本地历史？”提示。
2. 点击 **共享历史并重载**。
3. 等 VS Code 自动重载，再打开 Codex 历史列表。

暂时不想修改官方扩展，可点击 **Cancel**。以后随时按 `Ctrl+Shift+P`，运行 `Codex: 修复账户 / API 共享历史`。

这项修复只把官方 Codex 历史查询中的 Provider 过滤参数改成“查询全部 Provider”，不会读取、复制或修改任何会话内容，也不会改写 Codex 的历史数据库。官方 Codex 更新或重装会恢复原文件；切换器会在新版结构仍能通过严格校验时自动恢复。

> 共享范围仅限当前电脑、同一 `CODEX_HOME` 下的 Codex 本地会话。它不会把 API 会话上传到 ChatGPT，也不包含 `chatgpt.com` 或 ChatGPT 客户端的云端聊天记录。

切换连接会重载窗口。重载后再打开旧会话，后续请求使用状态栏显示的当前连接；Codex 可能把该会话已有的消息和上下文一并发给当前 Provider。继续敏感会话前，请先确认状态栏和目标服务方。

## 四、第一次出现 Max 修复提示

新电脑上的官方 Codex 可能已经支持 `Max`，但输入框下方的推理等级菜单会把它隐藏。本扩展启动后会先检查当前官方 Codex 版本；只有识别到唯一的已知过滤器时，才会显示下面的确认框。

![首次确认 Max 修复](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/enable-max.png)

想显示 `Max`：

1. 仔细阅读提示。
2. 点击 **修复 Max 并重载**。
3. 等 VS Code 自动重载。

暂时不想修改官方扩展，可点击 **Cancel**。以后随时按 `Ctrl+Shift+P`，运行 `Codex: 修复对话框中的 Max 推理等级`。

> 这项修复会在你明确同意后修改本机官方 Codex 扩展的一处 webview 资源。官方 Codex 更新或重装会恢复原文件；切换器会在新版结构仍能通过严格校验时自动恢复。详见下方“共享历史与 Max 兼容修复的边界”。

## 五、配置中转站 URL 和 API Key

### 第 1 步：打开切换菜单

有两种打开方法：

- 点击 VS Code **右下角状态栏**里的 `Codex: ChatGPT 账户` 或 `Codex: 自定义 API`；
- 按 `Ctrl+Shift+P`，输入并运行 `Codex: 切换账户 / 自定义 API`。

第一次配置时，点击 **配置自定义 API**。

![切换连接菜单](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/switch-connection.png)

### 第 2 步：输入 HTTPS Base URL

粘贴中转站提供的 Base URL，然后按 `Enter`。

![输入 HTTPS Base URL](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/configure-base-url.png)

注意：

- 必须以 `https://` 开头；
- 通常填写到 `/v1`，不要自己再追加 `/responses`，以中转站提供的地址为准；
- 不允许 URL 中带用户名、密码、查询参数或 `#` 片段；
- 示例图里的 `gateway.example.com` 只是演示地址，不能直接使用。

### 第 3 步：核对 API Key 会发往哪里

扩展会单独显示主机名和完整 Base URL。逐字核对，确认属于你信任的中转站后，点击 **信任并继续**。

![确认 API 主机](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/confirm-api-host.png)

如果主机名不对，点击 **Cancel**，不要输入 API Key。

### 第 4 步：输入 API Key

粘贴 API Key，确认输入框里显示为圆点后按 `Enter`。

![输入 API Key](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/configure-api-key.png)

API Key 会用当前 Windows 用户的 DPAPI 加密，并与这条完整 HTTPS Base URL 绑定。它不会以明文写进 `config.toml`。

### 第 5 步：真正切换到自定义 API

配置成功只代表“地址和密钥已经保存”，不会立即改变当前连接。请再打开一次切换菜单：

1. 点击右下角 `Codex: ChatGPT 账户`。
2. 点击 **自定义 API**。
3. 等 VS Code 自动重载。
4. 重载后查看右下角，确认显示 `Codex: 自定义 API`。

## 六、在输入框下方选择模型和推理等级

切换到自定义 API 并重载后，打开官方 Codex 面板。输入框下方会出现类似 `中转 · GPT-5.6-Sol Max` 的按钮。

### 选择推理等级

1. 点击输入框下方当前模型和推理等级的按钮。
2. 在 `Reasoning` 下直接点击需要的等级。
3. 菜单中可见 `Light`、`Medium`、`High`、`Extra High`、`Max` 和 `Ultra`。

![在 Codex 输入框下选择推理等级](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/reasoning-picker.png)

`Max` 是默认值。更高等级通常响应更慢、消耗更多 token；中转站或具体模型不支持某一等级时，请换低一档。

### 选择模型

1. 再次点击输入框下方的模型和推理等级按钮。
2. 点击菜单底部带 `>` 的当前模型行。
3. 在 `Model` 下选择 Sol、Terra 或 Luna。

![在 Codex 输入框下选择三个中转模型](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/model-picker.png)

建议切换模型后新建一个对话，避免旧对话继续沿用之前的模型状态。

## 七、切回 ChatGPT 账户

1. 点击 VS Code 右下角的 `Codex: 自定义 API`。
2. 在菜单中点击 **ChatGPT 账户**。
3. 等 VS Code 自动重载。
4. 重载后确认右下角显示 `Codex: ChatGPT 账户`。

切换器不会注销 ChatGPT，也不会删除官方 Codex 的登录信息。以后可以用同一个状态栏入口来回切换。

## 常见问题

### 提示找不到 `models_cache.json`

官方 Codex 还没有生成模型缓存。先切回 ChatGPT 账户，登录官方 Codex，打开一次新对话并展开一次模型菜单，然后重载窗口，再重新配置自定义 API。

### 已切换，但输入框下方还是官方模型

先看右下角状态栏是否为 `Codex: 自定义 API`。如果是，请运行 `Developer: Reload Window`，然后新建一个 Codex 对话。仍不正常时，重新执行一次 `Codex: 使用自定义 API`。

### 历史列表仍然只显示当前连接的会话

按 `Ctrl+Shift+P`，运行 `Codex: 修复账户 / API 共享历史`，同意修复并重载窗口。如果扩展提示当前官方 Codex 版本不受支持，它会保持所有文件不变；请先升级本切换器，再查看 GitHub Release 说明。

共享历史不会恢复已经删除的会话，也不会拉取其他电脑或 ChatGPT 云端的聊天记录。

### 新电脑没有 Max

按 `Ctrl+Shift+P`，运行 `Codex: 修复对话框中的 Max 推理等级`。如果扩展提示当前官方 Codex 版本不受支持，不会强行写入文件；请先升级本切换器，再查看 GitHub Release 说明。

### 改了中转站地址后不能继续使用原密钥

这是正常的安全限制。密钥与完整 Base URL 绑定，地址发生变化后必须重新输入 API Key。

### 想删除本机保存的中转站密钥

按 `Ctrl+Shift+P`，运行 `Codex: 删除本机自定义 API Key`。

## 共享历史与 Max 兼容修复的边界

### 共享本地历史

OpenAI App Server 的 `thread/list` 接口支持通过 `modelProviders` 过滤本地会话。当前官方 VS Code 扩展在若干历史查询中只取当前 Provider，因此账户和 API 的本地会话会分开显示。本扩展把经过验证的查询改为请求全部 Provider；不移动会话文件，也不读写历史数据库。参见 [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server)。

共享的是“历史入口和上下文”，不是两边服务端的数据同步。打开旧会话后，新请求会使用切换器当前选中的连接。

### Max 推理等级

OpenAI 官方配置参考公开支持用 `model_catalog_json` 加载本地模型目录，但公开的 `model_reasoning_effort` 枚举目前只列到 `xhigh`。因此，本扩展通过模型目录让 Codex 识别中转模型及其推理等级，同时把“让当前 VS Code 界面显示 Max”作为单独的兼容修复处理。参见 [OpenAI Codex Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)。

### 共同的安全限制

两项修复具有以下限制：

- 必须分别得到一次明确同意；
- 只检查发布者为 OpenAI、扩展 ID 为 `openai.chatgpt` 的本地官方扩展；
- 校验安装路径、符号链接、文件类型、文件大小、结构标记和匹配次数；
- 共享历史只修改扩展主程序和唯一的历史面板资源；任一写入失败都会尝试回滚，若文件同时被其他程序修改则拒绝覆盖并报告错误；
- Max 只有在已知过滤器恰好匹配一次时才会写入；
- 写入后再次校验结果，不认识的新版本会直接拒绝修改；
- 官方 Codex 更新、重装或 VS Code 安全工具可能恢复或报告被修改的资源。

如需恢复官方原文件，在 VS Code 扩展面板卸载并重新安装官方 Codex 扩展即可。

## 安全与隐私

- 扩展自身不发送网络请求，不收集遥测，也没有自定义更新通道。
- 只接受 HTTPS Base URL，并在首次配置或地址变化时要求确认目标主机。
- API Key 使用 Windows DPAPI 加密，不写入 `config.toml`。
- 切换器只管理自己的配置区块，并保留 ChatGPT 登录。
- 共享历史修复不读取或修改 Codex 的会话数据库，只调整官方界面的本地查询参数。
- 使用自定义 API 时，Codex 会把提示词、源码上下文、工具数据和 API Key 发送给你选择的服务方；你必须自行确认该服务方可信。
- 不要关闭 VS Code 的扩展签名校验，也不要从不可信镜像安装 VSIX。

完整边界见 [SECURITY.md](SECURITY.md) 和 [PRIVACY.md](PRIVACY.md)。

## 本地文件

- 设置：`~/.codex/lab-provider-switcher/settings.json`
- 生成的模型目录：`~/.codex/lab-provider-switcher/models.json`
- DPAPI 加密密钥：`~/.codex/lab-provider-switcher/api-key.v2.dpapi`
- 初始备份：`~/.codex/config.toml.before-provider-switcher`
- 最近备份：`~/.codex/config.toml.provider-switcher-last.bak`

这些文件不会打进 VSIX，也不会由本扩展上传。

## 兼容要求

- Windows 10/11；
- VS Code 1.96 或更高版本；
- 官方 OpenAI Codex VS Code 扩展；
- 支持 `POST <base_url>/responses`、SSE 流式输出和工具调用的 HTTPS 服务。

## 开发与验证

```powershell
npm ci
npm run verify
npm run package
```

## License

MIT
