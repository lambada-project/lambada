FROM node:24-bookworm

RUN apt-get update \
    && apt-get install -y --no-install-recommends less unzip \
    && rm -rf /var/lib/apt/lists/*

# AWS CLI v2
RUN curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-$(uname -m).zip" -o /tmp/awscli.zip \
    && unzip -q /tmp/awscli.zip -d /tmp \
    && /tmp/aws/install \
    && rm -rf /tmp/aws /tmp/awscli.zip

# AWS Emulator, which the tests run against: https://docs.aws.amazon.com/emulator/latest/userguide/
RUN curl -fsSLo /tmp/aws-emulator.deb \
        "https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/latest/aws-emulator_$(dpkg --print-architecture).deb" \
    && apt-get update \
    && apt-get install -y /tmp/aws-emulator.deb \
    && rm -rf /tmp/aws-emulator.deb /var/lib/apt/lists/*

USER node

# Pulumi CLI and Bun
RUN curl -fsSL https://get.pulumi.com | sh \
    && curl -fsSL https://bun.sh/install | bash
ENV PATH="/home/node/.pulumi/bin:/home/node/.bun/bin:${PATH}"
