ARG VARIANT="14-buster"
FROM mcr.microsoft.com/vscode/devcontainers/javascript-node:0-${VARIANT}

# PULUMI CLI
RUN curl -fsSL https://get.pulumi.com | sudo sh -s -- --version 3.24.1
RUN mv ~/.pulumi /pulumi
ENV PATH "/pulumi/bin:${PATH}"

# WS SDK
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
RUN ./aws/install

ENV AWS_PROFILE={{PROJECT_NAME}}