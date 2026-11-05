# ---- сборка (Gradle wrapper, байткод Java 17) ----
FROM eclipse-temurin:17-jdk AS build
WORKDIR /build

# сначала конфигурация сборки — слои кэшируются, исходники меняются чаще
COPY settings.gradle build.gradle gradlew gradlew.bat ./
COPY gradle ./gradle
COPY src ./src
COPY tests ./tests

RUN ./gradlew --no-daemon build -x test

# ---- рантайм: только JRE и артефакт ----
FROM eclipse-temurin:17-jre
WORKDIR /app

# curl нужен для healthcheck в docker-compose (запрос /health)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

COPY --from=build /build/libs/gymhelper-1.0.0.jar app.jar
# статика Mini App раздаётся с диска из рабочей папки
COPY web ./web

EXPOSE 8080
ENTRYPOINT ["java", "-jar", "app.jar"]
