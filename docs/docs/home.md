---
id: home
title: What is lambada?
sidebar_label: What is lambada?
slug: /
---

Lambada is a **very opinionated** set of tools and frameworks put together to speed up developer productivity.

We believe in "*true*" Infrastructure as Code, Replicable development environments, Integration Testing, Security, and Serverless.

Our tooling consists of:
- DevContainer configuration
- Docker Compose with:
    - Dockerfile to dev on, with:
        - Node
        - AWS-SDK V2
        - Latest Pulumi CLI
    - DynamoDb container image
- Prepopulated `package.json` with:
    - AWS-SDK
    - Pulumi-SDK
    - @lambada/core

If you want to jumpstart your development right now, check our [Quickstart guide](/quickstart).