FROM osgeo/gdal:alpine-small-3.2.1
LABEL maintainer "contact@kalisio.com"

COPY . /opt/bdortho/

WORKDIR /opt/bdortho

RUN apk add -u p7zip nodejs npm rclone curl findutils  && npm install


ENTRYPOINT ["node","/opt/bdortho/src/entrypoint.js"]

