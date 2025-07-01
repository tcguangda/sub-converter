# sub-converter

## 项目简介

sub-converter 是一个支持多种客户端格式的**订阅链接转换与短链生成服务**，支持 Singbox、Clash、Surge、Xray 等主流代理配置格式。支持多语言界面、在线转换、短链跳转、订阅配置存储等功能，适合自部署和团队共享。

## 主要功能
- 订阅链接格式互转（Singbox/Clash/Surge/Xray）
- 在线生成和管理短链，支持跳转
- 支持多语言切换（中/英/俄/波斯）
- 支持自定义规则、UA、基础配置
- 支持订阅配置存储与解析
- 支持 Docker 部署与数据持久化

## 目录结构简述
```
├── src/                # 核心业务代码
│   ├── kvSqlite.js     # SQLite 持久化 KV 封装
│   ├── ...             # 其它 builder、工具、i18n
├── database/           # SQLite 数据库存储目录（持久化）
├── server.js           # Node.js 启动入口
├── package.json        # 依赖与脚本
├── Dockerfile          # Docker 构建文件
├── docker-compose.yml  # Docker Compose 示例
```

## 源码构建与运行

1. 安装依赖
   ```bash
   npm install
   ```
2. 启动服务（默认 7788 端口）
   ```bash
   npm start
   # 或指定端口
   PORT=8080 npm start
   ```
3. 访问
   - http://localhost:7788

## Docker 构建与运行

1. 构建镜像
   ```bash
   docker build -t sublink-worker .
   ```
2. 运行容器（持久化数据库）
   ```bash
   docker run -d \
     -v /your/host/database:/app/database \
     -p 7788:7788 \
     --name sublink-worker \
     sublink-worker
   ```
   > 持久化目录 `/your/host/database` 用于保存 SQLite 数据库文件，防止数据丢失。

## Docker Compose 部署示例

新建 `docker-compose.yml`：
```yaml
version: '3'
services:
  sublink-worker:
    build: .
    container_name: sublink-worker
    ports:
      - "7788:7788"
    volumes:
      - ./database:/app/database
    restart: unless-stopped
```

启动：
```bash
docker-compose up -d
```

## 数据持久化说明
- 所有短链、配置等数据均存储于 `database/sublink_kv.db`（SQLite）
- 挂载 `database` 目录可实现数据持久化，适合 Docker 部署
- 首次运行自动创建 `database` 目录，无需手动操作

## 主要依赖
- Node.js >=14 <=20
- express
- better-sqlite3
- js-yaml

---
如有问题或建议，欢迎 issue 或 PR！
