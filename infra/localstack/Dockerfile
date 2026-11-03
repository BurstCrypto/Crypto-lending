FROM localstack/localstack:2026.10.4@sha256:2290500d7398e6458544fab2f49aaf170b81a1006ee69067e8e7fc59b810a824

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
