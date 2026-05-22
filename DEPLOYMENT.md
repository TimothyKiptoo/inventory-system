# REVA Engineering Services Inventory Deployment

This application is ready for public deployment with either:

- `Render` for the fastest managed deployment
- `Node.js + Nginx` on a VPS for full control

## Before You Deploy

1. Create a production MongoDB database.
   Recommended: MongoDB Atlas
2. Set strong secrets:
   - `MONGO_URI`
   - `JWT_SECRET`
   - `DEFAULT_ADMIN_EMAIL`
   - `DEFAULT_ADMIN_PASSWORD`
3. Set your public URL:
   - `PUBLIC_BASE_URL=https://inventory.yourdomain.com`
4. Set allowed browser origins:
   - `ALLOWED_ORIGINS=https://inventory.yourdomain.com`

## Option 1: Render

The app includes [render.yaml](/home/kiptootimothy/teamco/enterprise-pos/render.yaml:1).

### Steps

1. Push `enterprise-pos` to GitHub or GitLab.
2. In Render, create a new Blueprint or Web Service from the repo.
3. Confirm:
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Health check path: `/api/system/health`
4. Add environment variables from `.env.example`.
5. Point `PUBLIC_BASE_URL` to your Render URL or custom domain.
6. Add your custom domain in Render and update DNS.

### Recommended Render environment values

```env
HOST=0.0.0.0
PORT=10000
PUBLIC_BASE_URL=https://inventory.yourdomain.com
ALLOWED_ORIGINS=https://inventory.yourdomain.com
MONGO_URI=mongodb+srv://<user>:<password>@<cluster>/<db>?retryWrites=true&w=majority
JWT_SECRET=<strong-random-secret>
DEFAULT_ADMIN_EMAIL=admin@revaengineeringservices.com
DEFAULT_ADMIN_PASSWORD=<strong-admin-password>
```

## Option 2: VPS with Nginx

The sample Nginx reverse proxy is at [deploy/nginx/reva-inventory.conf](/home/kiptootimothy/teamco/enterprise-pos/deploy/nginx/reva-inventory.conf:1).

### Example Node service setup

1. Copy the app to your server.
2. Install Node.js 20+ and MongoDB or point to MongoDB Atlas.
3. Install dependencies:

```bash
npm install
npm run build
```

4. Create `.env` using `.env.example`.
5. Start the app with a process manager such as `pm2`:

```bash
pm2 start backend/server.js --name reva-engineering-inventory
pm2 save
```

6. Enable the Nginx site and reload Nginx.
7. Issue TLS certificates with Certbot.

### Example production values

```env
HOST=0.0.0.0
PORT=3000
PUBLIC_BASE_URL=https://inventory.yourdomain.com
ALLOWED_ORIGINS=https://inventory.yourdomain.com
```

## Vercel Note

Vercel can deploy Express apps, but this project is not the best fit for full feature parity because the current architecture uses long-lived realtime behavior through Socket.IO and SSE. If you choose Vercel, treat it as a limited or refactored deployment target and plan to replace realtime connections with an external provider.

## Health Check

Use:

```text
/api/system/health
```

Expected response:

```json
{
  "status": "ok"
}
```

## Security Checklist

- Change the default administrator password immediately
- Restrict `ALLOWED_ORIGINS` to your real domains
- Use HTTPS only in production
- Store secrets in your host’s environment-variable manager
- Back up MongoDB regularly
