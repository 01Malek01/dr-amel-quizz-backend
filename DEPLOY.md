# Deploying — API on a VPS, site on Vercel

Target setup:

```
student's browser ──HTTPS──> Vercel (Next.js site)
                 └─HTTPS──> nginx on the VPS ──> API container ──> MongoDB container
```

The server is `69.10.43.238`, and the API hostname used throughout is
`69-10-43-238.sslip.io` (see step 0). Change both if the server ever moves.

## 0. HTTPS without a domain

Vercel serves the site over HTTPS, and a browser on an HTTPS page refuses to
call `http://69.10.43.238/api` (mixed content). You therefore need HTTPS on the
API too, which needs a hostname, because a certificate cannot be issued for a
bare IP.

`sslip.io` solves this with no registration: **`69-10-43-238.sslip.io`** already
resolves to `69.10.43.238`. Let's Encrypt issues a normal certificate for it.
(`nip.io` is an identical alternative — try it if sslip.io ever fails.)

This guide uses `69-10-43-238.sslip.io` as the API host. If you buy a domain
later, point it at the IP and repeat step 6 with the new name.

Verified: it resolves to 69.10.43.238 via Google's resolver. Confirm from your own
machine with:

```bash
nslookup 69-10-43-238.sslip.io
```

If you cannot or will not use any hostname, skip to **Plan B** at the end.

## 1. Prepare the server

Log in as root, create a user, give it sudo and docker rights:

```bash
adduser deploy
usermod -aG sudo deploy
```

Open only what is needed:

```bash
ufw allow OpenSSH
ufw allow 80
ufw allow 443
ufw enable
```

Note that port 5007 is **not** opened: the API is published on `127.0.0.1` only
and is reached through nginx.

## 2. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
```

```bash
usermod -aG docker deploy
```

Log out and back in as `deploy`, then verify:

```bash
docker run --rm hello-world
```

## 3. Get the code

```bash
git clone https://github.com/01Malek01/dr-amel-quizz-backend.git ~/backend
cd ~/backend
```

The frontend repo is not needed on the server — Vercel builds it.

## 4. Fill in the environment file

```bash
cp .env.docker.example .env.docker
openssl rand -base64 48      # copy the output into DQ_JWT_SECRET
nano .env.docker
```

Mandatory:

| Variable | Value |
| -------- | ----- |
| `DQ_JWT_SECRET` | the random string you just generated |
| `DQ_ADMIN_PASSWORD` | the first admin password — change it after first login |
| `DQ_CLIENT_URL` | leave as is for now; step 7 sets the real Vercel domain |

Keep this file out of git — it is already ignored.

## 5. Start the API and the database

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker up -d --build
```

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker ps
```

Both services must read `healthy`. Then check the API answers locally:

```bash
curl http://127.0.0.1:5007/api/health
```

Expected: `{"status":"ok","time":"..."}`. If not:

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker logs backend
```

The admin account is created on first start, from the `DQ_ADMIN_*` values.

### If MongoDB will not start: kernel 6.19+

```
MongoDB cannot start: Linux kernel versions 6.19 and newer has a known
incompatibility with this version of MongoDB.
```

MongoDB 8 ships a vendored TCMalloc that corrupts memory on Linux kernels
6.19 through 7.0.13, so it refuses to start on them rather than risk your data
([SERVER-121912](https://jira.mongodb.org/browse/SERVER-121912)). Nothing in this
project causes it, and the refusal is deliberate — it is protecting the database.

Check the kernel:

```bash
uname -r
```

**Fix, in order of preference:**

1. **Upgrade the kernel to 7.0.14 or newer** and reboot. This is MongoDB's own
   fix and leaves nothing temporary behind.

   ```bash
   sudo apt update && sudo apt upgrade && sudo reboot
   ```

2. **If no newer kernel is available**, disable glibc's restartable sequences for
   the database container only. In `.env.docker`:

   ```
   DQ_MONGO_GLIBC_TUNABLES=glibc.pthread.rseq=0
   ```

   ```bash
   docker compose -f docker-compose.backend.yml --env-file .env.docker up -d
   ```

   Some reports say `glibc.pthread.rseq=1` is what works for them; if `=0` still
   refuses, try `=1` before anything else. Remove the line once the kernel is
   upgraded.

   Note that an Ubuntu kernel named `7.0.0-38-generic` is upstream **7.0.0**
   with Ubuntu's ABI number 38 — it is inside the affected range, and the check
   reads the upstream version, so distribution backports do not satisfy it.

3. **If neither works**, run the database outside the server: create a free
   MongoDB Atlas cluster, allow the server's IP in its network list, then set

   ```
   DQ_MONGO_URI=mongodb+srv://user:password@cluster.mongodb.net/dr-amel-quizzes
   ```

   and comment out the whole `mongo` service and the `depends_on` block in
   `docker-compose.backend.yml`. The kernel stops mattering, and backups become
   Atlas's job instead of yours.

Do **not** "fix" this by pinning an older MongoDB (`DQ_MONGO_IMAGE_TAG=7`).
Older releases lack the startup guard, which means they will run on an affected
kernel and may corrupt data silently — a far worse outcome than not starting.

## 6. nginx and the certificate

```bash
sudo apt update && sudo apt install -y nginx certbot python3-certbot-nginx
```

Create the site file:

```bash
sudo nano /etc/nginx/sites-available/dq-api
```

```nginx
server {
    listen 80;
    server_name 69-10-43-238.sslip.io;

    # الرفع محدود بـ 5MB في التطبيق
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:5007;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }
}
```

Do **not** add `add_header Access-Control-Allow-Origin` here — the application
sends that header itself, and two of them break every browser request.

Enable it, drop the default site, test and reload:

```bash
sudo ln -s /etc/nginx/sites-available/dq-api /etc/nginx/sites-enabled/dq-api
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

```bash
curl http://69-10-43-238.sslip.io/api/health
```

Now the certificate:

```bash
sudo certbot --nginx -d 69-10-43-238.sslip.io
```

Choose redirect when asked. certbot rewrites the file to listen on 443 and
renews by itself; confirm with:

```bash
sudo certbot renew --dry-run
curl https://69-10-43-238.sslip.io/api/health
```

The API base URL for the site is now:

```
https://69-10-43-238.sslip.io/api
```

## 7. The site on Vercel

1. Vercel → **Add New** → **Project** → import `dr-amel-quizz-frontend`.
2. Framework preset: Next.js. Root directory: the repo root. Leave the build
   command and output directory untouched.
3. **Environment Variables** → add, for Production, Preview and Development:

   ```
   NEXT_PUBLIC_API_URL = https://69-10-43-238.sslip.io/api
   ```

4. Deploy, and note the domain you get, e.g.
   `https://dr-amel-quizzes.vercel.app`.

This variable is compiled into the browser bundle, so changing it later requires
a redeploy, not just a save. Uploaded question images are served by the API host
from the same base, so it must be the public HTTPS address — never `127.0.0.1`.

Back on the server, allow that domain through CORS:

```bash
nano .env.docker
```

```
DQ_CLIENT_URL=https://dr-amel-quizzes.vercel.app,https://*.vercel.app
```

The second entry covers Vercel's preview deployments; `*` stands for one
subdomain level. Apply it:

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker up -d
```

Verify the header is sent for your domain and withheld for others:

```bash
curl -s -I -H "Origin: https://dr-amel-quizzes.vercel.app" https://69-10-43-238.sslip.io/api/health | grep -i access-control
curl -s -I -H "Origin: https://evil.example.com" https://69-10-43-238.sslip.io/api/health | grep -i access-control
```

The first prints the header, the second prints nothing. If a page later shows
"failed to fetch", this is the first thing to check.

## 8. First login and a smoke test

1. Open the Vercel domain, log in with `DQ_ADMIN_USERNAME` and
   `DQ_ADMIN_PASSWORD`.
2. Change the admin password from the users page.
3. Create a module, a topic, an exam with one question, publish it, and open the
   student link in a private window.
4. Upload an image inside a question and confirm it displays — that proves the
   uploads volume and nginx body limit are right.

## 9. Backups

Both matter: losing `uploads_data` loses question images, losing `mongo_data`
loses everything else.

```bash
docker exec dq-mongo mongodump --archive=/tmp/db.archive --db=dr-amel-quizzes \
  && docker cp dq-mongo:/tmp/db.archive ~/backups/db-$(date +%F).archive
```

```bash
docker run --rm -v dr-amel-quizzes_uploads_data:/data -v ~/backups:/backup busybox \
  tar czf /backup/uploads-$(date +%F).tar.gz -C /data .
```

Daily at 03:00 via `crontab -e`:

```cron
0 3 * * * cd /home/deploy/backend && docker exec dq-mongo mongodump --archive=/tmp/db.archive --db=dr-amel-quizzes && docker cp dq-mongo:/tmp/db.archive /home/deploy/backups/db-$(date +\%F).archive
```

Copy the files off the server regularly — a backup that only exists on the same
machine is not a backup.

`docker compose ... down -v` deletes both volumes. It is the one command never to
run on this server.

## 10. Deploying updates

API, by hand:

```bash
cd ~/backend && git pull
docker compose -f docker-compose.backend.yml --env-file .env.docker up -d --build
```

Site: push to the frontend repo's main branch — Vercel builds and deploys it.

### Automatic deployment from GitHub

`.github/workflows/deploy.yml` in the backend repo deploys on every push to
`main`: it connects over SSH, resets the checkout to `origin/main`, rebuilds the
containers, waits for `/api/health` to answer, and prunes old images. It fails
the run if the health check never passes, so a broken deploy is visible in the
Actions tab instead of silent.

Note that it runs `git reset --hard origin/main`, which discards anything edited
directly on the server inside the repository. `.env.docker` is untracked, so it
is untouched.

Create a key for it on the server (no passphrase, used only by Actions):

```bash
ssh-keygen -t ed25519 -C "github-actions" -f ~/.ssh/github_actions -N ""
```

```bash
cat ~/.ssh/github_actions.pub >> ~/.ssh/authorized_keys
```

Then in the repo, **Settings → Secrets and variables → Actions**, add:

| Secret | Value |
| ------ | ----- |
| `VPS_HOST` | `69.10.43.238` |
| `VPS_USERNAME` | the deploy user, e.g. `deploy` |
| `VPS_SSH_KEY` | the **private** key: the whole of `~/.ssh/github_actions` |
| `VPS_PORT` | only if SSH is not on 22 |
| `VPS_APP_DIR` | only if the repo is not at `~/backend` |

Print the private key to copy it, then clear your terminal:

```bash
cat ~/.ssh/github_actions
```

The user must be able to run `docker` without `sudo` (step 2 covers that), since
the workflow has no password to give.

The frontend repo has no workflow: Vercel builds and deploys the site itself on
every push to `main`. If the site ever moves onto this server, it needs one of
its own — rebuilding the `frontend` service from this repo's
`docker-compose.yml`, with `DQ_NEXT_PUBLIC_API_URL` set before the build.

Logs when something misbehaves:

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker logs -f backend
sudo tail -f /var/log/nginx/error.log
```

---

## Plan B — no hostname at all, Vercel proxies the API

Use this only if you refuse any hostname. The browser talks HTTPS to Vercel, and
Vercel forwards to your IP over plain HTTP, so **the Vercel→VPS leg, including
login passwords, is unencrypted.** Option 1 above avoids that for free.

Steps 1 to 5 are unchanged. nginx needs no certificate and serves the IP:

```nginx
server {
    listen 80;
    server_name _;
    client_max_body_size 6m;

    location / {
        proxy_pass http://127.0.0.1:5007;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

In the **frontend** repo, add `vercel.json`:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "http://69.10.43.238/api/:path*" },
    { "source": "/uploads/:path*", "destination": "http://69.10.43.238/uploads/:path*" }
  ]
}
```

On Vercel set the API URL to a relative path, so the site calls itself:

```
NEXT_PUBLIC_API_URL = /api
```

CORS no longer applies, because browser requests are same-origin. Leave
`DQ_CLIENT_URL` at any value; nothing checks it in this arrangement.

Trade-offs: all API traffic counts against your Vercel usage, uploaded images are
proxied on every view, and the unencrypted leg above. Move to option 1 or a
domain when you can — it is a certificate command and one env var.
