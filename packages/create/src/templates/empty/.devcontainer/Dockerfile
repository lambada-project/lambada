FROM mcr.microsoft.com/vscode/devcontainers/javascript-node:0-16-buster
RUN apt-get update
RUN apt-get upgrade -y

# PULUMI CLI
RUN curl -fsSL https://get.pulumi.com | sudo sh -s
RUN mv ~/.pulumi /pulumi
ENV PATH "/pulumi/bin:${PATH}"

# WS SDK
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
RUN ./aws/install

# RUN apt-get install -y python3 python3-pip
# Only run this if the localstack config changes
# RUN pip3 install pulumi-local 