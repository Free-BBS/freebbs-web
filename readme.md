# FREE-BBS

FREE-BBS web frontend and backend.

## Structure

- `public/`: 首页与前端静态资源
- `backend/`: Node.js 认证后端与 MySQL 访问
- `database/`: 建库建表与管理员种子数据

## Run

前端静态页：

```bash
npm install
npm run start:frontend
```

后端 API：

```bash
npm run start:backend
```

## Database

初始化 MySQL：

```bash
mysql -u root -p < database/schema.sql
mysql -u root -p < database/seed.sql
```

管理员默认账户：

- username: `admin`
- password: `free-bbs`
