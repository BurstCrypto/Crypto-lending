FROM localstack/localstack:2026.8.1@sha256:2026.8.1aef81c531684570d7b3cfd2805afa02194c929d52bbeedabb7d4874798b1572

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
