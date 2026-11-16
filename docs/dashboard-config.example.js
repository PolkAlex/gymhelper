// Пример конфига дашборда. Скопируйте в dashboard-config.js (рядом) и подставьте
// свои raw-URL из secret-gist'ов (см. docs/metrics.md — разделы «Дашборд» и «ANA-дашборд»).
// Сам dashboard-config.js в .gitignore: ссылки на данные не попадают в публичный репозиторий.
window.GYM_DASH = {
    anaUrl: "https://gist.githubusercontent.com/<USER>/<GIST_ID_ANA>/raw/ana-stats.json",
    metricsUrl: "https://gist.githubusercontent.com/<USER>/<GIST_ID_METRICS>/raw/metrics.json"
};
