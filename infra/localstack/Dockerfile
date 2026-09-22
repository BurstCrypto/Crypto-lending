FROM localstack/localstack:2026.8.3@sha256:2026.8.3abc29e923e5ed8a63d6c705a9dfa74b15d560e7055845299d87b22dabf9f6e2

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
