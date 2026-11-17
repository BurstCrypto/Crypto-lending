FROM localstack/localstack:2026.10.7@sha256:96102ee38f6b84792711c86f5244f8f438277ff090cf7eb75deba82513f94aa8

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
