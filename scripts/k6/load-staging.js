// k6 нагрузочный скрипт для staging.
// Запуск:
//   k6 run scripts/k6/load-staging.js                          (smoke: 1 VU)
//   k6 run --env STAGING_URL=https://staging.example.com --env MODE=load scripts/k6/load-staging.js
// Прогон load поднимает до 100 VU за 2 мин, держит 5 мин, спад 1 мин.
// Thresholds: p95 < 500ms, ошибки < 1% — как и принято для «k6 100 VU на staging».

import http from 'k6/http'
import { check } from 'k6'

const BASE_URL = __ENV.STAGING_URL || 'http://localhost:3002'
const MODE = __ENV.MODE || 'smoke'

export const options = MODE === 'load'
  ? {
      scenarios: {
        load: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: '2m', target: 100 },
            { duration: '5m', target: 100 },
            { duration: '1m', target: 0 },
          ],
          gracefulRampDown: '30s',
        },
      },
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500'],
      },
    }
  : {
      scenarios: {
        smoke: { executor: 'shared-iterations', vus: 1, iterations: 20 },
      },
      thresholds: {
        http_req_failed: ['rate<0.01'],
        http_req_duration: ['p(95)<500'],
      },
    }

export default function () {
  const health = http.get(`${BASE_URL}/health`)
  check(health, { 'health: статус 200': (r) => r.status === 200 })

  const content = http.get(`${BASE_URL}/api/content`)
  check(content, { 'content: статус 200': (r) => r.status === 200 })
}