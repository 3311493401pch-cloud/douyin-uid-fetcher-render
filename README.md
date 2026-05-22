# 抖音 UID 获取网站

本项目用于从抖音分享文本或短链接中提取：

- 作者 UID
- 当前分享视频 UID / `aweme_id`
- 当前视频分享链接

## 本地运行

请先确认已安装 Node.js 18 或更高版本。

```bash
npm start
```

启动后打开终端提示的地址，例如：

```text
http://localhost:3000
```

如果 `3000` 端口被占用，程序会自动尝试 `3001`、`3002` 等后续端口。

## 部署成公网网站

推荐使用 Render 部署，因为本项目需要运行 Node.js 后端服务。

### 1. 上传到 GitHub

在 GitHub 新建一个仓库，然后把本项目代码上传到仓库。

需要上传的核心文件包括：

- `server.js`
- `package.json`
- `render.yaml`
- `public/index.html`
- `public/styles.css`
- `public/app.js`

### 2. 在 Render 创建 Web Service

打开 Render：

```text
https://render.com
```

然后按下面步骤操作：

1. 注册或登录 Render。
2. 点击 `New +`。
3. 选择 `Web Service`。
4. 连接你的 GitHub 仓库。
5. 选择这个项目仓库。
6. Render 会自动读取 `render.yaml`。
7. 点击创建并等待部署完成。

### 3. 访问公网地址

部署成功后，Render 会提供一个公网地址，格式类似：

```text
https://douyin-uid-fetcher.onrender.com
```

把这个地址发给别人，别人就可以直接访问。

## Render 手动配置参考

如果 Render 没有自动读取配置，可以手动填写：

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Health Check Path: /
```

环境变量可以不填。

## 注意事项

抖音页面可能会因风控、登录状态、访问频率或服务器 IP 环境导致无法返回完整数据。即使页面受限，本工具仍会尽量从短链跳转信息中提取作者 UID 和视频 UID。
