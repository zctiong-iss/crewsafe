# node:22-bookworm  (tag kept in comment for humans; digest is the immutable pin)
FROM node@sha256:0557ac14e0d45d02ed563067b82856ca5e7aa3437fa28d98d4350ea9c3d9494a AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . ./
RUN npm run build

# nginxinc/nginx-unprivileged:1.31.3-alpine3.24  (tag in comment; digest is the pin)
FROM nginxinc/nginx-unprivileged@sha256:a6c3ec0c0d249d68b0682df854d4a9e222b90fb607dc3fcf2f1d2fcbc85d347e AS runtime

COPY --from=build /app/dist/ /usr/share/nginx/html/
COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 8080
USER nginx
