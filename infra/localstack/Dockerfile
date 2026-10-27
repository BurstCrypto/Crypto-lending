FROM localstack/localstack:2026.10.2@sha256:0e95fa70a58fff808cdc4c8deea8cf56a247cdad403c082e33ec37924987e0c3

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
