#!/usr/bin/env bash

set -euo pipefail

endpoint_url="${AWS_ENDPOINT_URL:-http://127.0.0.1:4566}"
region="${AWS_DEFAULT_REGION:-us-east-1}"
max_receive_count="${SQS_MAX_RECEIVE_COUNT:-5}"
visibility_timeout="${SQS_VISIBILITY_TIMEOUT_SECONDS:-30}"

dlq_url="$(aws --endpoint-url="$endpoint_url" --region="$region" sqs create-queue \
  --queue-name wager-transactions-dlq.fifo \
  --attributes FifoQueue=true \
  --query QueueUrl \
  --output text)"

dlq_arn="$(aws --endpoint-url="$endpoint_url" --region="$region" sqs get-queue-attributes \
  --queue-url "$dlq_url" \
  --attribute-names QueueArn \
  --query Attributes.QueueArn \
  --output text)"

queue_url="$(aws --endpoint-url="$endpoint_url" --region="$region" sqs create-queue \
  --queue-name wager-transactions.fifo \
  --attributes FifoQueue=true \
  --query QueueUrl \
  --output text)"

attributes="$(printf \
  '{"FifoQueue":"true","ReceiveMessageWaitTimeSeconds":"20","VisibilityTimeout":"%s","RedrivePolicy":"{\"deadLetterTargetArn\":\"%s\",\"maxReceiveCount\":\"%s\"}"}' \
  "$visibility_timeout" \
  "$dlq_arn" \
  "$max_receive_count")"

aws --endpoint-url="$endpoint_url" --region="$region" sqs set-queue-attributes \
  --queue-url "$queue_url" \
  --attributes "$attributes"

aws --endpoint-url="$endpoint_url" --region="$region" sqs create-queue \
  --queue-name integration-events.fifo \
  --attributes FifoQueue=true \
  >/dev/null
