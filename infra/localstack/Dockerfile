FROM localstack/localstack:2026.10.8@sha256:be800da7b2f20deeebb1a4fef113ff4fc7fa28871cac4de5036a1ac69e22b6dc

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
