#!/bin/bash
# Chạy khi LocalStack sẵn sàng: tạo bucket, cấu hình CORS và lifecycle giống production.
set -euo pipefail

bucket="${S3_BUCKET:-qloud-dev}"
origins_json=$(printf '%s' "${S3_CORS_ORIGINS:-http://localhost:5173}" \
  | awk -F, '{for (i = 1; i <= NF; i++) printf "%s\"%s\"", (i > 1 ? "," : ""), $i}')

awslocal s3api head-bucket --bucket "$bucket" 2>/dev/null \
  || awslocal s3api create-bucket --bucket "$bucket"

# Trình duyệt PUT từng part lên presigned URL và cần đọc header ETag
awslocal s3api put-bucket-cors --bucket "$bucket" --cors-configuration "{
  \"CORSRules\": [{
    \"AllowedOrigins\": [${origins_json}],
    \"AllowedMethods\": [\"GET\", \"PUT\", \"HEAD\"],
    \"AllowedHeaders\": [\"*\"],
    \"ExposeHeaders\": [\"ETag\"],
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

echo "[init-s3] bucket '$bucket' ready (CORS: ${S3_CORS_ORIGINS:-http://localhost:5173})"
