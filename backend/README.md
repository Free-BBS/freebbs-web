# Backend

启动认证后端：

```bash
npm install
npm run start:backend
```

默认监听：

- API: `http://127.0.0.1:3001`

可用环境变量：

- `API_HOST`
- `API_PORT`
- `BACKEND_IP`：MySQL 服务器 IP。若未设置，自动回退为本机 IPv4 地址
- `MYSQL_PORT`
- `MYSQL_USER`
- `MYSQL_PASSWORD`
- `MYSQL_DATABASE`
- `AUTH_SECRET`
- `BOTMAIL_SMTP`
- `BOTMAIL_SMTP_PORT`
- `BOTMAIL_USER`
- `BOTMAIL_FROM`
- `BOTMAIL_PASS`

主要接口：

- `GET /api/health`
- `POST /api/auth/send-email-code`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/me`
