FROM localstack/localstack:2026.8.0@sha256:21fe0a67fe7993a5b0082a29bfc94fce5a15b6622c87b0d98f9df2882a9afca3

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
