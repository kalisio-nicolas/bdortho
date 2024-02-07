FROM osgeo/gdal:alpine-small-3.2.1
LABEL maintainer "contact@kalisio.com"


COPY . /opt/bdortho/

WORKDIR /opt/bdortho

RUN apk add -u p7zip nodejs npm rclone curl findutils  && npm install && chown -R 1000:1000 /opt/bdortho

ENTRYPOINT ["node","/opt/bdortho/src/entrypoint.js"]

