#!/usr/bin/env bash

set -euo pipefail

endpoint_url="${AWS_ENDPOINT_URL:-http://127.0.0.1:4566}"
region="${AWS_DEFAULT_REGION:-us-east-1}"

aws --endpoint-url="$endpoint_url" --region="$region" sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true

aws --endpoint-url="$endpoint_url" --region="$region" sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true
