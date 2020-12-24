# See here for image contents: https://github.com/microsoft/vscode-dev-containers/tree/v0.148.1/containers/javascript-node/.devcontainer/base.Dockerfile

# [Choice] Node.js version: 14, 12, 10
ARG VARIANT="14-buster"
FROM mcr.microsoft.com/vscode/devcontainers/javascript-node:0-${VARIANT}

# [Optional] Uncomment this section to install additional OS packages.
# RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
#     && apt-get -y install --no-install-recommends <your-package-list-here>

# [Optional] Uncomment if you want to install more global node modules
# RUN sudo -u node npm install -g <your-package-list-here>

#PULUMI 
#RUN curl -fsSL https://get.pulumi.com/ | sudo sh
RUN curl -fsSL https://get.pulumi.com | sudo sh -s -- --version 2.13.2
RUN mv ~/.pulumi /pulumi
ENV PATH "/pulumi/bin:${PATH}"

#AWS SDK
RUN curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
RUN unzip awscliv2.zip
RUN ./aws/install

ENV AWS_PROFILE=andreujuanc