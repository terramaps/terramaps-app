FROM alpine/git AS version
WORKDIR /git
COPY .git .git
RUN git log -1 --no-color '--pretty=Commit: %H%nDate: %cD%n' > git-version.txt

FROM node:22-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm@9
COPY app/package.json app/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY app/vite.config.ts app/index.html app/tsconfig.*json app/eslint.config.js ./

COPY app/public ./public
COPY app/src ./src

RUN pnpm run build

FROM nginx:1-alpine

# Set the default port to 80
ENV PORT=80

# Remove the default Nginx static assets
RUN rm -rf /usr/share/nginx/html/*
RUN rm -rf /etc/nginx/conf.d/*

# Copy the build output
COPY --from=builder /app/dist /usr/share/nginx/html
COPY --from=version /git/git-version.txt /usr/share/nginx/html/version.txt

# Copy setup file to docker entrypoint
COPY app/setup_config.sh /docker-entrypoint.d/40-setup_config.sh

# Write the Nginx configuration template files
RUN mkdir -p /etc/nginx/templates
RUN echo ' \
server { \
    listen       ${PORT}; \
    listen  [::]:${PORT}; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html; \
        try_files $uri /index.html; \
    } \
}' > /etc/nginx/templates/default.conf.template