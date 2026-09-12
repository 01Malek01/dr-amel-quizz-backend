# ---------- التبعيات (بدون تبعيات التطوير) ----------
FROM node:24-bookworm-slim AS deps

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---------- التشغيل ----------
FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=5007
ENV UPLOAD_DIR=uploads

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js ./
COPY src ./src

# مجلد الصور المرفوعة: يُنشأ ويُملَّك للمستخدم node قبل ربط الـ volume،
# وإلا لن يستطيع التطبيق الكتابة فيه عند التشغيل بمستخدم غير root.
RUN mkdir -p /app/uploads && chown -R node:node /app

USER node

EXPOSE 5007

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5007)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
