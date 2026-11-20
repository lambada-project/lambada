---
title: AWS credentials
sidebar_label: AWS credentials
slug: /aws-config
description: Give Pulumi and your tests AWS credentials, with profiles, SSO or a devcontainer.
---

Pulumi deploys with the same credentials the AWS CLI uses. Before you deploy, check that your terminal reaches the right account:

```bash
aws sts get-caller-identity
```

## IAM Identity Center (SSO)

If your organization uses IAM Identity Center, configure a profile once and log in when the session expires:

```bash
aws configure sso          # once: creates a named profile
aws sso login --profile my-dev
export AWS_PROFILE=my-dev
```

## Access keys

For a personal account, store access keys in the credentials file rather than in the environment:

```ini title="~/.aws/credentials"
[my-dev]
aws_access_key_id = AKIAIOSFODNN7EXAMPLE
aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
```

```ini title="~/.aws/config"
[profile my-dev]
region = eu-west-1
output = json
```

See [Configuration and credential file settings](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html) for every option and other operating systems.

## Choosing a profile

With several profiles, pick one per shell with `AWS_PROFILE`, or pin it to a Pulumi stack so each environment always deploys to its own account:

```bash
pulumi config set aws:profile my-dev --stack dev
pulumi config set aws:profile my-prod --stack prod
pulumi config set aws:region eu-west-1
```

## In a devcontainer

A devcontainer loses whatever you logged in with when it is rebuilt. Mount your AWS folder read-only and select the profile in the container's environment:

```json title=".devcontainer/devcontainer.json"
{
  "mounts": ["source=${localEnv:HOME}/.aws,target=/home/node/.aws,type=bind,readonly"],
  "containerEnv": { "AWS_PROFILE": "my-dev" }
}
```

SSO logins write their token cache under `~/.aws/sso`, so with a read-only mount, run `aws sso login` on the host.
