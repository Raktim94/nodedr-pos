# --- deps stage: install with full build toolchain for native modules ---
FROM node:20-alpine AS deps
RUN apk add --no-cache python3 make g++ udev linux-headers eudev-dev libusb-dev pkgconfig
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# --- builder stage: generate Prisma client ---
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate

# --- runtime stage: slim image, no build toolchain ---
FROM node:20-alpine AS runtime
RUN apk add --no-cache openssl libusb eudev-libs
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
