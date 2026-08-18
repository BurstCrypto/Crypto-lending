#!/usr/bin/env bash
set -euo pipefail

REGION="${AWS_DEFAULT_REGION:-us-east-1}"
ACCOUNT_ID="000000000000"
DLQ_NAME="crypto-lending-jobs-dlq"
QUEUE_NAME="crypto-lending-jobs"
MAX_RECEIVE_COUNT="${SQS_MAX_RECEIVE_COUNT:-3}"

awslocal sqs create-queue \
  --region "${REGION}" \
  --queue-name "${DLQ_NAME}" \
  --attributes 'MessageRetentionPeriod=1209600'

DLQ_ARN="arn:aws:sqs:${REGION}:${ACCOUNT_ID}:${DLQ_NAME}"
REDRIVE_POLICY="{\"deadLetterTargetArn\":\"${DLQ_ARN}\",\"maxReceiveCount\":\"${MAX_RECEIVE_COUNT}\"}"
QUEUE_ATTRIBUTES="$(REDRIVE_POLICY="${REDRIVE_POLICY}" python -c 'import json, os; print(json.dumps({"VisibilityTimeout": "30", "MessageRetentionPeriod": "345600", "ReceiveMessageWaitTimeSeconds": "10", "RedrivePolicy": os.environ["REDRIVE_POLICY"]}))')"

awslocal sqs create-queue \
  --region "${REGION}" \
  --queue-name "${QUEUE_NAME}" \
  --attributes "${QUEUE_ATTRIBUTES}"
