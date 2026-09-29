FROM localstack/localstack:2026.8.4@sha256:03bde1974f8bb7a7b6d4128228cf9048c7bdb8249deb998d1b80af73926c0017

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
