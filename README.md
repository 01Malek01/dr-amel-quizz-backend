# Dr. Amel Quizzes — Backend

Express + MongoDB (Mongoose) API for the quiz platform. Serves the admin
dashboard and the student-facing exams, scales and results.

The frontend lives in a separate repository
([dr-amel-quizz-frontend](https://github.com/01Malek01/dr-amel-quizz-frontend));
the Docker compose file in **this** repo builds and runs both together.

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
| `tests/student-feedback-exam.test.js` | the full student run: start, retries, feedback style resolution, first-try badge, perceived-usefulness gate, completion, in-test survey |
| `tests/admin-crud.test.js` | students, groups, modules, topics, exams, questions, publishing, settings, all stats endpoints |
| `tests/surveys.test.js` | scale CRUD, items, activation, link submissions, and that link results stay separate from in-test results |
| `tests/normal-exams.test.js` | normal exam CRUD, student submission and grading, scheduling window |

`tests/helpers.js` holds the shared harness (boot/shutdown, HTTP client, fixtures).
To add a test, drop a new `tests/*.test.js` file next to the others and use the
same helpers.

## Deployment with Docker

One compose file in this repo runs the whole stack: MongoDB, the API and the
Next.js site. Both apps are published **only on `127.0.0.1`**, so nginx installed
directly on the host (not in a container) is what terminates TLS and proxies to
them.

### The two repos must sit side by side

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

### Configure

```bash
cp .env.docker.example .env.docker
```

Fill in `.env.docker` — `DQ_JWT_SECRET` and `DQ_ADMIN_PASSWORD` are mandatory and
the stack refuses to start without them:

```bash
openssl rand -base64 48
```

Then build and start:

```bash
docker compose --env-file .env.docker up -d --build
```

> **Always pass `--env-file .env.docker`.** The compose variables are prefixed
> `DQ_` precisely so that a forgotten flag fails loudly instead of silently
> picking up the development values in `backend/.env`.

Check it came up:

```bash
docker compose --env-file .env.docker ps
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

### What is preserved

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

### Everyday commands

```bash
docker compose --env-file .env.docker logs -f backend
```

```bash
docker compose --env-file .env.docker restart backend
```

```bash
docker compose --env-file .env.docker up -d --build
```

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
