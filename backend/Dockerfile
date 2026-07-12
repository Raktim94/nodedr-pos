# --- deps stage ---
# better-sqlite3 (Prisma's SQLite driver adapter) ships prebuilt musl/Alpine
# binaries, no toolchain needed for it. `usb` (direct-USB ESC/POS printing,
# see src/lib/escposUsb.js) also ships a prebuilt linux-x64 musl binary, but
# empirically its install script doesn't reliably skip straight to that
# prebuild on Alpine — with no compiler present it falls through to `node-gyp
# rebuild` and fails outright, so the toolchain below is required at install
# time even though no actual compilation ends up happening in practice
# (verified in a scratch node:24-alpine container). None of this is needed
# in the runtime stage — see the small libudev/libstdc++ runtime deps there
# instead of this whole toolchain.
FROM node:24-alpine AS deps
RUN apk add --no-cache openssl python3 make g++ linux-headers eudev-dev libusb-dev pkgconfig
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force

# --- builder stage: generate Prisma client ---
FROM node:24-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json prisma.config.js ./
COPY prisma ./prisma
COPY src ./src
RUN npx prisma generate

# --- runtime stage: slim image ---
FROM node:24-alpine AS runtime
# eudev-libs (libudev.so, used by `usb`'s libusb backend for device
# enumeration) and libstdc++ (the addon is a C++ build) are the only
# runtime-side additions for direct-USB printing — confirmed by copying a
# deps-stage build of `usb` into a fresh container with just these two
# packages installed (no compiler, no libusb-dev) and requiring it
# successfully. libusb itself is statically linked into the addon, so no
# separate libusb runtime package is needed.
RUN apk add --no-cache openssl eudev-libs libstdc++
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json /app/prisma.config.js ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/src ./src

EXPOSE 4000

CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]
