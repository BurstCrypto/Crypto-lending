FROM localstack/localstack:2026.8.2@sha256:3fe5b51caec82b966a34485b5b43efd68075ff8161f9b0a34091fad9abb0ff82

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
