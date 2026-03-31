# Demo — Secure Service Architecture

Mô phỏng một stack bảo mật nhiều lớp cho web service, bao gồm: Cloudflare edge, OpenResty gateway với JWT verification bằng Lua, Fail2ban, và Cloudflare Turnstile.

## Kiến trúc tổng quan

```
User Browser
    │
    ▼
Cloudflare (edge)
  - Bot Fight Mode
  - Turnstile challenge (managed widget)
  - DDoS protection
  - Full (Strict) SSL
    │
    ▼ (chỉ Cloudflare IPs mới qua được UFW)
OpenResty / Nginx  [157.20.83.195]
  - Rate limit: 10 req/s per IP (burst 20)
  - JWT verify bằng Lua (gateway level)
  - Security headers (HSTS, CSP, X-Frame-Options...)
  - Access log → Fail2ban
    │
    ├──► Frontend  [127.0.0.1:4000]  (Next.js 14 standalone Docker)
    └──► Backend   [127.0.0.1:3001]  (Fastify Docker)
              - POST /auth/token  → verify Turnstile → issue JWT (30 min)
              - GET  /api/v1/data → trả data (JWT đã được check ở gateway)
```

## Cấu trúc thư mục

```
demo/
├── backend/          # Fastify API service
│   ├── index.js
│   ├── Dockerfile
│   └── .env          # KHÔNG commit — chứa JWT_SECRET, TURNSTILE_SECRET
│
├── fe/               # Next.js 14 frontend
│   ├── app/page.tsx  # Toàn bộ Turnstile + JWT lifecycle
│   ├── .env.production  # NEXT_PUBLIC_API_URL=https://api.blog360.org
│   └── Dockerfile
│
└── infra/            # Toàn bộ cấu hình server
    ├── docker-compose.yml        # chạy backend + fe
    ├── openresty/
    │   ├── nginx.conf            # rate limit zones, log format CF-Connecting-IP
    │   ├── sites/demo.conf       # virtual host: HTTP redirect, FE proxy, API proxy + Lua JWT
    │   └── snippets/             # ssl, security headers, cloudflare IPs, rate-limit
    ├── fail2ban/
    │   ├── jail.local            # 2 jails: 403 (10 hits→1h ban), 429 (5 hits→2h ban)
    │   └── filter.d/             # regex match CF-Connecting-IP từ OpenResty access log
    └── ansible/
        ├── site.yml
        ├── ansible.cfg
        ├── inventory/hosts.ini   # KHÔNG commit — IP + user
        └── roles/
            ├── common/           # apt update, ufw
            ├── docker/           # cài Docker
            ├── nginx/            # cài OpenResty + lua-resty-jwt
            └── fail2ban/         # cài Fail2ban + copy config
```

## Secrets — KHÔNG commit

| File | Nội dung |
|------|----------|
| `backend/.env` | `JWT_SECRET`, `TURNSTILE_SECRET` |
| `infra/ansible/inventory/hosts.ini` | IP server, SSH user |
| `*.key` | Private keys (Cloudflare Origin Certificate) |

Copy từ mẫu rồi điền tay:
```bash
cp backend/.env.example backend/.env
# điền JWT_SECRET và TURNSTILE_SECRET
```

## Luồng JWT (Frontend)

1. Kiểm tra `localStorage` — nếu token còn hơn 5 phút → dùng luôn
2. Còn dưới 5 phút → **silent refresh** ngầm (Turnstile chạy background, swap token mới)
3. Không có token / hết hạn → hiện Turnstile widget → exchange lấy JWT → lưu localStorage

## Deploy

### 1. Build và push images lên server

```bash
# Backend
cd backend
docker build -t demo-backend .
docker save demo-backend | ssh user@157.20.83.195 'docker load'

# Frontend
cd ../fe
docker build -t demo-fe .
docker save demo-fe | ssh user@157.20.83.195 'docker load'
```

### 2. Chạy với docker-compose

```bash
scp infra/docker-compose.yml user@157.20.83.195:~/
ssh user@157.20.83.195
docker compose --env-file /path/to/.env up -d
```

### 3. Setup server bằng Ansible (lần đầu)

```bash
cd infra/ansible
cp inventory/hosts.ini.example inventory/hosts.ini  # điền IP
ansible-playbook site.yml
```

## Các lớp bảo mật

| Layer | Công nghệ | Mục đích |
|-------|-----------|----------|
| Edge | Cloudflare | Bot Fight, DDoS, SSL termination |
| Firewall | UFW | Chỉ cho phép Cloudflare IPs vào port 80/443 |
| Rate limit | OpenResty | 10 req/s burst 20, 429 nếu vượt |
| Challenge | Cloudflare Turnstile | Xác thực real user trước khi cấp JWT |
| Auth | JWT (30 min) | Mọi API call phải có Bearer token |
| Gateway auth | Lua (lua-resty-jwt) | JWT verify ở OpenResty, không để lọt vào Node |
| Ban | Fail2ban | Auto-ban IP sau nhiều lần 403/429 |
| Headers | Security headers | HSTS, CSP, X-Frame-Options, etc. |
