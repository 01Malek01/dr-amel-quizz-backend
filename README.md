# Dr. Amel Quizzes — Backend

Express + MongoDB (Mongoose) API for the quiz platform. Serves the admin
dashboard and the student-facing exams, scales and results.

The frontend lives in a separate repository
([dr-amel-quizz-frontend](https://github.com/01Malek01/dr-amel-quizz-frontend)).
This repo carries two Docker compose files: one for the API and MongoDB alone
(site on Vercel) and one that runs both apps on a single server.

## Running locally

```bash
npm install
cp .env.example .env
npm run dev        # http://localhost:5007
```

`.env`:

```ini
PORT=5007
MONGO_URI=mongodb://127.0.0.1:27017/dr-amel-quizzes
JWT_SECRET=change-me
JWT_EXPIRES_IN=7d
CLIENT_URL=http://localhost:3006
ADMIN_NAME=Dr. Amel
ADMIN_EMAIL=admin@dramel-quizzes.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
UPLOAD_DIR=uploads
```

On first start the server seeds an admin account from `ADMIN_EMAIL` /
`ADMIN_PASSWORD`.

## npm scripts

| Script | Does |
| ------ | ---- |
| `npm run dev` | nodemon on port 5007 |
| `npm start` | production start |
| `npm test` | integration tests — see below |
| `npm run test:watch` | tests, re-run on save |
| `npm run seed` | demo chapters/topics/questions |
| `npm run simulate` | demo students + results so the admin tables are populated |
| `npm run simulate:clean` | remove that demo data |

## Layout

```
src/
├── controllers/   request handlers
├── models/        mongoose schemas
├── routes/        express routers
├── services/      shared logic (surveys, normal exams)
├── middleware/    auth, error handling, uploads
├── utils/         jwt, codes, regex escaping, serialisation
└── scripts/       seeding and simulation
tests/             integration suite
```

## Testing

The backend ships an integration suite that exercises every endpoint for both
roles — admin and student — including the failure paths.

```bash
npm test
```

**Requirements:** a MongoDB running locally (the same one the dev server uses).
Nothing else — the tests use Node's built-in `node:test` runner, so there are no
test dependencies in the project.

**It is safe to run any time.** Each test file spins the Express app on a random
free port and creates its own scratch database (`dq_test_*`), which it drops
when it finishes. Your development data is never touched, and you can run the
suite while `npm run dev` is up.

### Reading the output

Each test prints a `✔` line, grouped under `▶` suites, followed by a summary:

```
ℹ tests 137
ℹ suites 23
ℹ pass 137
ℹ fail 0
```

`fail 0` is the only line you need to check. A failure prints a `✖ failing tests:`
block naming the file, the line and the expected-vs-actual value, and the process
exits non-zero — so it works unchanged in CI.

### Other ways to run it

```bash
npm run test:watch                              # re-run on save
node --test "tests/surveys.test.js"             # one file
node --test --test-name-pattern="الكأس" "tests/*.test.js"   # tests matching a name
```

### What the suite covers

| File | Area |
| ---- | ---- |
| `tests/auth-authz.test.js` | login, `/me`, role enforcement on every admin route, bad tokens, invalid ids, malformed bodies |
| `tests/student-feedback-exam.test.js` | the full student run: start, retries, feedback style resolution, first-try badge, perceived-usefulness gate, completion |
| `tests/admin-crud.test.js` | students, groups, modules, topics, exams, questions, publishing, settings, all stats endpoints |
| `tests/surveys.test.js` | creating a link from the predefined scale, one link per exam, activation, link submissions and results |
| `tests/normal-exams.test.js` | normal exam CRUD, student submission and grading, scheduling window |

`tests/helpers.js` holds the shared harness (boot/shutdown, HTTP client, fixtures).
To add a test, drop a new `tests/*.test.js` file next to the others and use the
same helpers.

## Deployment with Docker

Two compose files, pick one:

| File | Runs | Use when |
| ---- | ---- | -------- |
| `docker-compose.backend.yml` | MongoDB + API | the site is hosted on Vercel |
| `docker-compose.yml` | MongoDB + API + Next.js site | everything on one VPS |

Either way the API is published **only on `127.0.0.1`**, so nginx installed
directly on the host (not in a container) is what terminates TLS and proxies to
it. MongoDB is never published on a port: only the API reaches it, over the
private compose network.

Both files use the same project name and the same volumes, so switching between
them keeps the database and the uploaded images.

### Configure (both options)

```bash
cp .env.docker.example .env.docker
```

Fill in `.env.docker` — `DQ_JWT_SECRET` and `DQ_ADMIN_PASSWORD` are mandatory and
the stack refuses to start without them:

```bash
openssl rand -base64 48
```

> **Always pass `--env-file .env.docker`.** The compose variables are prefixed
> `DQ_` precisely so that a forgotten flag fails loudly instead of silently
> picking up the development values in `backend/.env`.

`DQ_CLIENT_URL` is the list of origins the browser may call the API from.
Several are separated by commas, and `*` stands for one subdomain level, which
covers Vercel's preview deployments:

```
DQ_CLIENT_URL=https://dr-amel-quizzes.vercel.app,https://*.vercel.app
```

An origin that is not listed gets no CORS header and the browser blocks it, so a
missing entry shows up as "failed to fetch" in the site rather than as a server
error. Leaving it empty allows every origin — never do that on the internet.

## Option A — backend + MongoDB, site on Vercel

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker up -d --build
```

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker ps
```

Both services should read `healthy`, with the API shown as
`127.0.0.1:5007->5007`. Every command further down works the same with
`-f docker-compose.backend.yml` added.

### On the Vercel side

Set one environment variable in the Vercel project and redeploy:

```
NEXT_PUBLIC_API_URL=https://api.example.com/api
```

It is compiled into the browser bundle, so it only takes effect on a new build.
Uploaded question images are served by this same API host (`/uploads/...`), which
the site derives from this variable — so it must be the public HTTPS domain,
never `127.0.0.1`.

### nginx for the API domain

```nginx
server {
    server_name api.example.com;

    client_max_body_size 6m;   # الرفع محدود بـ 5MB في التطبيق

    location / {
        proxy_pass http://127.0.0.1:5007;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Then issue the certificate, e.g. `certbot --nginx -d api.example.com`. CORS is
handled by the app itself, so do not add `add_header Access-Control-Allow-Origin`
in nginx — two of those headers break every browser request.

## Option B — everything on one server

`docker-compose.yml` builds the frontend from `../frontend`, so clone both into
the same parent directory — the build fails otherwise:

```
dr-amel-quizzes/
├── backend/     # this repo
└── frontend/    # dr-amel-quizz-frontend
```

```bash
git clone https://github.com/01Malek01/dr-amel-quizz-backend.git backend
git clone https://github.com/01Malek01/dr-amel-quizz-frontend.git frontend
```

```bash
docker compose --env-file .env.docker up -d --build
```

All three services should read `healthy`, with ports shown as
`127.0.0.1:5007->5007` and `127.0.0.1:3006->3006`.

### Set the API URL before building

`NEXT_PUBLIC_API_URL` is compiled into the browser bundle, so it cannot be
changed by an environment variable at run time. Set `DQ_NEXT_PUBLIC_API_URL` to
the address **the browser** will use, then rebuild:

```bash
docker compose --env-file .env.docker up -d --build frontend
```

For a VPS behind nginx that is your public URL, e.g. `https://example.com/api`.

### nginx on the host

Point the site at the frontend and `/api` at the backend:

```nginx
server {
    server_name example.com;

    client_max_body_size 6m;   # الرفع محدود بـ 5MB في التطبيق

    location /api/ {
        proxy_pass http://127.0.0.1:5007;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /uploads/ {
        proxy_pass http://127.0.0.1:5007;
    }

    location / {
        proxy_pass http://127.0.0.1:3006;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Set `DQ_CLIENT_URL` to `https://example.com` so CORS matches, and
`DQ_NEXT_PUBLIC_API_URL` to `https://example.com/api`, then rebuild the frontend.

## MongoDB memory

The database container is capped at **512 MB of WiredTiger cache** and 1 GB of
container memory in `docker-compose.backend.yml`. Without a cap MongoDB takes
roughly half the host's RAM, which is too much for a small VPS. Both are
adjustable in `.env.docker`:

```
DQ_MONGO_CACHE_GB=0.5
DQ_MONGO_MEM_LIMIT=1g
```

Verified on this image: `db.serverStatus().wiredTiger.cache["maximum bytes
configured"]` reads 536870912.

## What is preserved

Three named volumes survive `docker compose down`, rebuilds and image upgrades:

| Volume | Holds |
| ------ | ----- |
| `uploads_data` | question and answer images uploaded by the admin (`/app/uploads`) |
| `mongo_data` | the whole database (`/data/db`) |
| `mongo_config` | MongoDB's internal config (`/data/configdb`) |

Verified: after `docker compose down` and `up` again, an uploaded image still
served 200 and the database rows were intact.

`docker compose down -v` **deletes all three** — it is the one command to avoid
on a live server.

Back them up with:

```bash
docker run --rm -v dr-amel-quizzes_uploads_data:/data -v "$PWD:/backup" busybox tar czf /backup/uploads-backup.tar.gz -C /data .
```

```bash
docker exec dq-mongo mongodump --archive=/tmp/db.archive --db=dr-amel-quizzes && docker cp dq-mongo:/tmp/db.archive ./db-backup.archive
```

## Everyday commands

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker logs -f backend
```

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker restart backend
```

Deploy a new version after `git pull`:

```bash
docker compose -f docker-compose.backend.yml --env-file .env.docker up -d --build
```
