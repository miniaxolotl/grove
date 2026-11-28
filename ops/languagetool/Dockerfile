FROM maven:3.9-eclipse-temurin-17@sha256:1a352420f7aba21f5ad08df31bab55f74c013fb491f1ae8ab1dd7ff9ed698584 AS unpack
RUN curl --fail --show-error --silent --location --proto '=https' --proto-redir '=https' \
      --retry 3 --retry-max-time 180 --connect-timeout 10 --max-time 60 \
      --output /tmp/lt.zip https://maven-central.storage-download.googleapis.com/maven2/org/languagetool/languagetool-standalone/6.8/languagetool-standalone-6.8.zip \
    && echo 'f04aecf37e35ef17d44b336da9668a5a3a871edd14bd83a766a7e110b9ebcd21  /tmp/lt.zip' | sha256sum -c -
WORKDIR /src
RUN jar xf /tmp/lt.zip
WORKDIR /src/LanguageTool-6.8
COPY GroveServer.java /src/
RUN javac -proc:none -cp 'languagetool-server.jar:libs/*' -d . /src/GroveServer.java

FROM eclipse-temurin:17-jre-noble@sha256:042c05a77eb915684fc8c92cfbbef4fd6f8c24ca7d934d1a7db3543453aaa077
WORKDIR /opt/lt
COPY --from=unpack /src/LanguageTool-6.8/ ./
COPY --chmod=0444 server.properties start.sh ./
USER 65532:65532
ENTRYPOINT ["/bin/sh", "/opt/lt/start.sh"]
HEALTHCHECK --interval=20s --timeout=3s --start-period=180s --start-interval=2s CMD curl -fs --max-time 2 http://127.0.0.1:8081/ready >/dev/null
