FROM localstack/localstack:2026.9.1@sha256:0c644ede65c2d0c95737e09a39007828bd381bdb07ca8200c6bf17d66a4ed191

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
