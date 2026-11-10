FROM localstack/localstack:2026.10.6@sha256:f94401988db4c01a5b2634d37d698a9b11c93f74c1ad0f7a8849f5ebd73dcbdc

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
