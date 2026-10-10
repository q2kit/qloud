#!/bin/bash
# Chạy khi LocalStack sẵn sàng: tạo bucket, cấu hình CORS và lifecycle giống production.
# - qloud-dev (S3_BUCKET): dev, cho origin của Vite (S3_CORS_ORIGINS).
# - qloud-e2e: Playwright, cho origin của `vite preview` (qloud_frontend/playwright.config.ts).
set -euo pipefail

configure_bucket() {
  local bucket="$1" origins="$2" origins_json
  origins_json=$(printf '%s' "$origins" \
    | awk -F, '{for (i = 1; i <= NF; i++) printf "%s\"%s\"", (i > 1 ? "," : ""), $i}')

  awslocal s3api head-bucket --bucket "$bucket" 2>/dev/null \
    || awslocal s3api create-bucket --bucket "$bucket"

  # Trình duyệt PUT từng part lên presigned URL và cần đọc header ETag
  awslocal s3api put-bucket-cors --bucket "$bucket" --cors-configuration "{
    \"CORSRules\": [{
      \"AllowedOrigins\": [${origins_json}],
      \"AllowedMethods\": [\"GET\", \"PUT\", \"HEAD\"],
      \"AllowedHeaders\": [\"*\"],
      \"ExposeHeaders\": [\"ETag\", \"Accept-Ranges\", \"Content-Range\", \"Content-Length\"],
      \"MaxAgeSeconds\": 3600
    }]
  }"

  # Dự phòng cho upload bị bỏ dở (xem features/upload.md)
  awslocal s3api put-bucket-lifecycle-configuration --bucket "$bucket" --lifecycle-configuration '{
    "Rules": [{
      "ID": "abort-incomplete-multipart",
      "Status": "Enabled",
      "Filter": {},
      "AbortIncompleteMultipartUpload": {"DaysAfterInitiation": 8}
    }]
  }'

  echo "[init-s3] bucket '$bucket' ready (CORS: $origins)"
}

configure_bucket "${S3_BUCKET:-qloud-dev}" "${S3_CORS_ORIGINS:-http://localhost:5173}"
configure_bucket "${S3_E2E_BUCKET:-qloud-e2e}" "${S3_E2E_CORS_ORIGINS:-http://localhost:4173}"
