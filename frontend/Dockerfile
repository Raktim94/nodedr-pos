# --- deps stage ---
FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

# --- builder stage ---
FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# No API URL is baked into the *client* bundle — the browser only ever calls
# the Next.js origin. The server-side /api proxy destination (next.config.ts
# rewrites) IS resolved at build time into the routes manifest, so BACKEND_URL
# is a build arg. It defaults to the backend service name on the Docker
# network; the browser never sees this value.
ARG BACKEND_URL=http://backend:4000
ENV BACKEND_URL=$BACKEND_URL
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# --- runtime stage ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 3000
CMD ["node", "server.js"]
