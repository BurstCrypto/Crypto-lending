FROM localstack/localstack:2026.7.5@sha256:0d74e1d2d7ce13a3cb25fc64cf15eb225f1c95c762e56e057bc6a9ed0ed29306

COPY init/10-create-queues.sh /etc/localstack/init/ready.d/10-create-queues.sh
RUN chmod 0755 /etc/localstack/init/ready.d/10-create-queues.sh
