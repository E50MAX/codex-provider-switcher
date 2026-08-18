# Secure Codex Provider Switcher（非官方）

这是一个仅限 Windows 的 VS Code 扩展，用来在官方 Codex 的两种连接之间切换：

- 已登录的 ChatGPT 账户；
- 你自己信任的 HTTPS Responses API 中转站。

两种连接使用同一个 `CODEX_HOME`，并可在官方 Codex 中显示同一份本地历史列表。已有会话不需要导出或复制；切换连接并重载后，新对话和重新恢复的空闲旧会话都会使用当前连接。

> **旧会话会保留原 `thread ID` 和历史，不会复制成空白对话。** Codex 数据库里原有的 `modelProvider` 元数据不会被改写；切换器会在恢复前读取 App Server 当前有效配置与模型目录，并核对登录状态、Provider、模型、推理等级和服务档。窗口重载交接期间的短暂写锁会自动等待重试；活动会话不会被强制中断，任何关键状态无法验证时都会阻止发送。

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

这项修复只负责让历史入口可见，不负责实际请求连接。旧会话的运行时 Provider 由下一节的独立修复接管和校验。

## 四、第一次启用旧会话 Provider 接管

为了让当前连接真正用于旧会话，本扩展会单独检查官方 Codex 的 `thread/resume` 调用结构。只有目标资源唯一且所有安全结构都通过校验时，才会显示确认框。

1. 等当前正在生成的回复结束。
2. 仔细阅读“让当前连接接管账户 / API 的旧会话？”提示。
3. 点击 **启用旧会话切换并重载**。
4. 重载后确认右下角显示 `Codex 当前: 账户` 或 `Codex 当前: API`。

暂时不启用可点击 **Cancel**。以后按 `Ctrl+Shift+P`，运行 `Codex: 修复旧会话 Provider 接管`。

这项修复会在明确同意后修改官方 Codex 的一处本地 webview 资源。恢复旧会话时，它先通过只读的 `config/read` 取得当前工作目录下的有效配置，再用 `model/list` 核对当前 Provider 真正可用的模型、推理等级和服务档；账户模式还会用 `account/read`（`refreshToken: false`）确认 ChatGPT 已登录。兼容的会话专属选择会保留；切换账户或 API 后已不兼容的选择会依次回退到当前配置或模型默认值。随后它把完整选择明确传给 `thread/resume`，对窗口重载交接造成的短暂写锁做最多约 10 秒的有限重试，并核对同一 `thread ID` 和实际运行时选择。

若当前 App Server 已经用另一套选择加载该会话，扩展不会在同一运行时里伪装成接管成功，而是取消本连接的订阅、阻止发送并要求干净地重载窗口。切换过程本身不发送模型请求，也不改写 Codex 的会话数据库、rollout 文件、历史消息、图片或压缩记录。

> 在旧会话发送下一条消息时，该会话保留的提示词、源码上下文、图片引用和工具输出可能会提供给新 Provider 或新登录账户。这是一次新的隐私与信任边界，请只切换到你信任的服务。若会话仍活动或任何校验失败，扩展会借用官方的写入冲突保护阻止发送。2.3.4 会先读取并核对当前完整选择，再自动等待窗口交接；提示仍存在时，请确认没有其他 VS Code/Codex 窗口在运行该任务，然后执行 `Developer: Reload Window`。

## 五、第一次出现 Max 修复提示

新电脑上的官方 Codex 可能已经支持 `Max`，但输入框下方的推理等级菜单会把它隐藏。本扩展启动后会先检查当前官方 Codex 版本；只有识别到唯一的已知过滤器时，才会显示下面的确认框。

![首次确认 Max 修复](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/enable-max.png)

想显示 `Max`：

1. 仔细阅读提示。
2. 点击 **修复 Max 并重载**。
3. 等 VS Code 自动重载。

暂时不想修改官方扩展，可点击 **Cancel**。以后随时按 `Ctrl+Shift+P`，运行 `Codex: 修复对话框中的 Max 推理等级`。

> 这项修复会在你明确同意后修改本机官方 Codex 扩展的一处 webview 资源。官方 Codex 更新或重装会恢复原文件；切换器会在新版结构仍能通过严格校验时自动恢复。详见下方“共享历史、旧会话接管与 Max 兼容修复的边界”。

## 六、配置中转站 URL 和 API Key

### 第 1 步：打开切换菜单

有两种打开方法：

- 点击 VS Code **右下角状态栏**里的 `Codex 当前: 账户` 或 `Codex 当前: API`；
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

配置保存后，如果当前仍是 ChatGPT 账户，扩展会明确提示 **当前连接仍是 ChatGPT 账户**：

1. 点击 **立即切换到自定义 API**；也可以稍后从状态栏切换。
2. 先等正在运行的回复结束，再让 VS Code 自动重载。
3. 查看右下角，确认显示 `Codex 当前: API`。
4. 可以继续当前对话，也可以从共享历史打开任意旧对话；恢复时会核对实际 Provider，确认是 API 后才允许继续。

如果右下角显示黄色警告 `Codex 默认: API`，说明旧会话接管保护尚未就绪。先运行 `Codex: 修复旧会话 Provider 接管` 并重载，不要在旧会话中发送。

## 七、在输入框下方选择模型和推理等级

切换到自定义 API 并重载后，打开官方 Codex 面板。输入框下方会出现类似 `中转 · GPT-5.6-Sol Max` 的按钮。

### 选择推理等级

1. 点击输入框下方当前模型和推理等级的按钮。
2. 在 `Reasoning` 下直接点击需要的等级。
3. 菜单中可见 `Light`、`Medium`、`High`、`Extra High`、`Max` 和 `Ultra`。

![在 Codex 输入框下选择推理等级](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/reasoning-picker.png)

扩展不会再强制把 `Max` 设为默认值。重新打开或切换连接时会优先保留退出前保存且当前模型仍支持的推理等级；没有可恢复值时使用模型自身默认值。更高等级通常响应更慢、消耗更多 token；中转站或具体模型不支持某一等级时，请换低一档。

### 选择模型

1. 再次点击输入框下方的模型和推理等级按钮。
2. 点击菜单底部带 `>` 的当前模型行。
3. 在 `Model` 下选择 Sol、Terra 或 Luna。

![在 Codex 输入框下选择三个中转模型](https://raw.githubusercontent.com/E50MAX/codex-provider-switcher/main/docs/images/model-picker.png)

同一 Provider 内切换模型或推理等级后，官方 Codex 会把选择保存为会话状态。重新打开旧会话时，2.3.4 会保留当前模型目录仍支持的会话专属选择；如果切换账户或 API 后该模型、推理等级或服务档已不可用，则改用当前连接里的兼容配置，再不行才用该模型的默认值。

## 八、切回 ChatGPT 账户

1. 点击 VS Code 右下角的 `Codex 当前: API`。
2. 在菜单中点击 **ChatGPT 账户**。
3. 等当前回复结束，再让 VS Code 自动重载。
4. 重载后确认右下角显示 `Codex 当前: 账户`；新对话和重新恢复的空闲旧会话都会使用账户连接。

切换器不会注销 ChatGPT，也不会删除官方 Codex 的登录信息。以后可以用同一个状态栏入口来回切换。

如果你在官方 Codex 中主动退出并登录另一个 ChatGPT 账户，本地历史仍属于当前 Windows 用户的同一个 `CODEX_HOME`，不会按 ChatGPT 身份隔离。新账户能看到共享列表里的本地会话；切换器只确认“当前确实登录了一个 ChatGPT 账户”，不会把旧 thread 绑定到原账户邮箱。2.3.4 会移除新账户模型目录不支持的旧账户配置，但不会隐藏旧账户留下的本地内容。

## 常见问题

### 提示找不到 `models_cache.json`

第一次配置时，官方 Codex 还没有生成模型缓存。先切回 ChatGPT 账户，登录官方 Codex，打开一次新对话并展开一次模型菜单，然后重载窗口，再重新配置自定义 API。成功生成过中转模型目录后，2.3.4 会在新账户缓存暂时缺少 Sol、Terra 或 Luna 时继续使用这份已经校验并保存在本机的目录。

### 已切换，但输入框下方还是官方模型

先看右下角状态栏是否为 `Codex 当前: API`。如果显示 `Codex 默认: API`，先运行 `Codex: 修复旧会话 Provider 接管`。保护就绪但模型仍未刷新时，运行 `Developer: Reload Window`；仍不正常再执行一次 `Codex: 使用自定义 API`。

### 已选 API，却仍提示 ChatGPT 账户额度耗尽

先确认右下角是 `Codex 当前: API`，而不是黄色警告 `Codex 默认: API`。如果是后者，运行 `Codex: 修复旧会话 Provider 接管`，同意修复并重载。2.3.4 会在恢复旧会话前读取 App Server 当前有效配置与模型目录，并核对恢复结果；只有 Provider、模型、推理等级和服务档都一致才允许继续发送。

如果 Codex 显示“在另一个应用中打开”一类提示，2.3.4 会先自动等待最多约 10 秒，让重载前的 App Server 释放写锁。提示仍存在时，先确认其他 VS Code/Codex 窗口没有运行该任务，再执行 `Developer: Reload Window`；不要删除会话文件、数据库或 writer-lock 文件。保护不会强制中断活动请求，也不会在任何运行时选择不明确时放行消息。

官方 Codex 在 API 模式下仍可能为登录状态、模型目录或界面信息执行账户侧后台请求，因此日志中偶尔出现账户额度警告不一定代表对话走错连接。2.3.4 会以 `config/read`、`model/list` 和 `thread/resume` 返回的运行时选择一致作为放行依据；状态栏为 `Codex 当前: API` 且旧会话恢复成功后，该会话才可继续发送。

### 历史列表仍然只显示当前连接的会话

按 `Ctrl+Shift+P`，运行 `Codex: 修复账户 / API 共享历史`，同意修复并重载窗口。如果扩展提示当前官方 Codex 版本不受支持，它会保持所有文件不变；请先升级本切换器，再查看 GitHub Release 说明。

共享历史不会恢复已经删除的会话，也不会拉取其他电脑或 ChatGPT 云端的聊天记录。

### 退出后登录另一个 ChatGPT 账户，会读错历史吗

不会把请求误发给已经退出的账户：账户模式恢复旧会话前会用不刷新 token 的 `account/read` 确认当前确实登录了 ChatGPT；未登录或登录状态无法读取时会阻止发送。新账户可用模型不同也不会沿用不兼容选择，旧配置会回退到新账户当前支持的值。

但本地历史不会按 ChatGPT 身份隔离。只要还是同一个 Windows 用户和 `CODEX_HOME`，新登录账户就能看到并继续这些本地会话，包括旧账户或自定义 API 创建的内容。需要身份隔离时，应为不同账户使用不同的 Windows 用户或不同的 `CODEX_HOME`，不要启用共享历史。

### 旧会话里的图片还能读取吗

切换器不解析或重写消息内容。已测试 App Server 恢复内嵌图片数据与 `localImage` 路径时，图片项、普通消息和 `contextCompaction` 项都会保留。内嵌数据不会因切换器丢失；本地路径图片仍要求原文件存在且当前进程可访问，原文件被移动或删除后无法由切换器补回。

继续旧会话会把 Codex 认为仍需要的图片引用和上下文交给当前 Provider；这可能跨越账户或服务商的隐私边界。共享历史只保证本机记录按原样交给官方 App Server，不承诺第三方中转站一定接受相同的图片输入格式。

### 上下文窗口满了、发生压缩后会出 bug 吗

切换器不会删除或重写 `contextCompaction`。隔离测试验证了包含多次压缩的 rollout 可以在切换模型和推理等级后恢复并继续，原 thread ID 与可读取的历史项保持不变。模型下一轮实际收到的是 Codex 压缩后的摘要和仍保留的上下文，不是把压缩前每个 token 与每张旧图片重新完整发送；这是 App Server 的压缩语义，不是历史被自动删除。

自定义模型目录会保留官方模板中的上下文窗口和自动压缩阈值元数据，但中转站必须真的支持所声明模型的上下文长度与 Responses API 行为。若中转站实际限制更小，仍可能由服务端返回超限错误。

### 新电脑没有 Max

按 `Ctrl+Shift+P`，运行 `Codex: 修复对话框中的 Max 推理等级`。如果扩展提示当前官方 Codex 版本不受支持，不会强行写入文件；请先升级本切换器，再查看 GitHub Release 说明。

### 改了中转站地址后不能继续使用原密钥

这是正常的安全限制。密钥与完整 Base URL 绑定，地址发生变化后必须重新输入 API Key。

### 想删除本机保存的中转站密钥

按 `Ctrl+Shift+P`，运行 `Codex: 删除本机自定义 API Key`。

## 共享历史、旧会话接管与 Max 兼容修复的边界

### 共享本地历史

OpenAI App Server 的 `thread/list` 接口支持通过 `modelProviders` 过滤本地会话。当前官方 VS Code 扩展在若干历史查询中只取当前 Provider，因此账户和 API 的本地会话会分开显示。本扩展把经过验证的查询改为请求全部 Provider；不移动会话文件，也不读写历史数据库。参见 [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server)。

共享的是“历史入口”，不是两边服务端的数据同步。App Server 返回的每个 thread 都带有 `modelProvider`；切换器不会改写数据库中的该字段。

### 旧会话 Provider 接管

OpenAI App Server 的 `thread/resume` 支持指定 `modelProvider`、模型、服务档和配置覆盖，`config/read` 可返回配置分层后的当前有效配置，`model/list` 可返回当前可用模型及其推理等级。`thread/unsubscribe` 只移除当前连接的订阅；最后一个订阅者离开后，服务器仍会让 thread 在约 30 分钟的空闲宽限期内保持 loaded，不能把取消订阅当成立即卸载。2.3.4 会在每次恢复前解析并验证完整运行时选择，账户模式还会检查当前 ChatGPT 登录态；它只对窗口重载期间真实返回的短暂 writer conflict 做有限重试，成功后再核对 thread 身份和 App Server 实际返回的 Provider、模型、推理等级与服务档。若已加载运行时仍是另一套选择，则安全阻止发送并要求重载。参见 [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server)。

这是一项运行时接管，不是数据库迁移。旧会话的标题、消息、图片项、压缩项和 `thread ID` 保持不变；活动 thread 不会被强行释放，写锁超时、取消订阅失败、身份变化或运行时选择不匹配都会阻止发送。切换本身不调用模型，但在旧会话发送下一条消息会把该会话需要的历史上下文交给新 Provider 或新登录账户。

### Max 推理等级

OpenAI 官方配置参考公开支持用 `model_catalog_json` 加载本地模型目录，但公开的 `model_reasoning_effort` 枚举目前只列到 `xhigh`。因此，本扩展通过模型目录让 Codex 识别中转模型及其推理等级，同时把“让当前 VS Code 界面显示 Max”作为单独的兼容修复处理。参见 [OpenAI Codex Configuration Reference](https://learn.chatgpt.com/docs/config-file/config-reference)。

### 共同的安全限制

三项修复具有以下限制：

- 必须分别得到一次明确同意；
- 只检查发布者为 OpenAI、扩展 ID 为 `openai.chatgpt` 的本地官方扩展；
- 校验安装路径、符号链接、文件类型、文件大小、结构标记和匹配次数；
- 旧会话接管只修改唯一且经过验证的恢复调用；仅对官方 writer conflict 做有上限的等待重试，并要求同一 thread 身份与实际 Provider。已加载的 Provider 不匹配时只取消本连接的订阅并拒绝放行，不在 30 分钟空闲宽限期内立即重试；
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
- 旧会话接管不改写数据库中的 Provider；它在恢复时验证实际运行时 Provider，并保留同一 `thread ID`。
- 状态栏只有在接管保护就绪时才显示 `Codex 当前: …`；黄色的 `Codex 默认: …` 不是旧会话实际路由证明。
- 切换动作本身不发送模型请求；在旧会话继续发送会把保留的相关上下文提供给新 Provider。
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
